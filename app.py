#!/usr/bin/env python3
"""Local, authenticated development runner for the Prep Cafe app."""

from __future__ import annotations

import hashlib
import hmac
import json
import math
import mimetypes
import os
import re
import secrets
import sqlite3
import sys
import time
import uuid
from datetime import date, datetime, timezone
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
CATALOG = json.loads((WEB / "catalog.json").read_text(encoding="utf-8"))
DB_PATH = Path(os.environ.get("PREP_DB_PATH", ROOT / "runtime" / "prep-cafe.sqlite3"))
SESSION_COOKIE = "prep_session"
SESSION_SECONDS = 60 * 60 * 12
PBKDF2_ROUNDS = 310_000
MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
}


def connect_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def initialize_db() -> None:
    with connect_db() as db:
        db.executescript(
            """
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS operator (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                email TEXT NOT NULL UNIQUE,
                password_salt BLOB NOT NULL,
                password_hash BLOB NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                operator_id INTEGER NOT NULL REFERENCES operator(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sales (
                id TEXT PRIMARY KEY,
                record_date TEXT NOT NULL,
                menu_id TEXT NOT NULL,
                channel TEXT NOT NULL,
                quantity INTEGER NOT NULL CHECK(quantity >= 0),
                unit_price INTEGER NOT NULL CHECK(unit_price >= 0),
                discount_amount INTEGER NOT NULL CHECK(discount_amount >= 0),
                payment_fee INTEGER NOT NULL CHECK(payment_fee >= 0),
                food_cost_per_item REAL,
                packaging_cost_per_item REAL,
                cost_source TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(record_date, menu_id, channel)
            );
            CREATE TABLE IF NOT EXISTS expenses (
                id TEXT PRIMARY KEY,
                record_date TEXT NOT NULL,
                category TEXT NOT NULL,
                amount INTEGER NOT NULL CHECK(amount >= 0),
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS inventory_events (
                id TEXT PRIMARY KEY,
                record_date TEXT NOT NULL,
                material_id TEXT NOT NULL,
                event_type TEXT NOT NULL CHECK(event_type IN ('restock', 'waste', 'stocktake')),
                quantity REAL NOT NULL CHECK(quantity >= 0),
                note TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS sales_by_date ON sales(record_date DESC);
            CREATE INDEX IF NOT EXISTS expenses_by_date ON expenses(record_date DESC);
            CREATE INDEX IF NOT EXISTS inventory_by_date ON inventory_events(record_date DESC);
            """
        )
        columns = {row["name"] for row in db.execute("PRAGMA table_info(sales)")}
        for name, definition in (
            ("food_cost_per_item", "REAL"),
            ("packaging_cost_per_item", "REAL"),
            ("cost_source", "TEXT"),
        ):
            if name not in columns:
                db.execute(f"ALTER TABLE sales ADD COLUMN {name} {definition}")
        legacy_rows = db.execute(
            "SELECT id, record_date, menu_id, channel FROM sales WHERE food_cost_per_item IS NULL OR packaging_cost_per_item IS NULL"
        ).fetchall()
        for row in legacy_rows:
            snapshot = menu_cost_snapshot(row["menu_id"], row["channel"], row["record_date"])
            if snapshot:
                db.execute(
                    "UPDATE sales SET food_cost_per_item=?, packaging_cost_per_item=?, cost_source='reference-catalog' WHERE id=?",
                    (snapshot["food"], snapshot["packaging"], row["id"]),
                )


def json_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400, field: str | None = None):
        super().__init__(message)
        self.status = status
        self.field = field


def valid_date(value: object) -> str:
    if not isinstance(value, str):
        raise ApiError("날짜를 입력해 주세요.", field="date")
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        raise ApiError("날짜는 YYYY-MM-DD 형식으로 입력해 주세요.", field="date")
    if parsed.strftime("%Y-%m-%d") != value:
        raise ApiError("올바른 날짜를 입력해 주세요.", field="date")
    return value


def integer(value: object, label: str, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not float(value).is_integer():
        raise ApiError(f"{label}은(는) 정수로 입력해 주세요.", field=field)
    result = int(value)
    if result < 0:
        raise ApiError(f"{label}은(는) 0 이상이어야 합니다.", field=field)
    return result


def quantity(value: object, label: str, field: str, allow_fraction: bool) -> float | int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ApiError(f"{label}을(를) 숫자로 입력해 주세요.", field=field)
    result = float(value)
    if result < 0 or result > 1_000_000_000:
        raise ApiError(f"{label}은(는) 0 이상이어야 합니다.", field=field)
    if not allow_fraction and not result.is_integer():
        raise ApiError(f"{label}은(는) 정수로 입력해 주세요.", field=field)
    return result if allow_fraction else int(result)


def nonempty_text(value: object, label: str, field: str, maximum: int = 120) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ApiError(f"{label}을(를) 선택해 주세요.", field=field)
    clean = value.strip()
    if len(clean) > maximum:
        raise ApiError(f"{label}은(는) {maximum}자 이내로 입력해 주세요.", field=field)
    return clean


def password_digest(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)


def session_hash(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def menu_lookup() -> dict[str, dict]:
    return {item["id"]: item for item in CATALOG["menus"]}


def material_lookup() -> dict[str, dict]:
    return {item["id"]: item for item in CATALOG["materials"]}


def menu_cost_snapshot(menu_id: str, channel: str, record_date: str) -> dict | None:
    """Return per-item food and packaging costs at the price in effect on a date."""
    if menu_id not in menu_lookup():
        return None
    recipes = [item for item in CATALOG.get("recipes", []) if item["menuId"] == menu_id]
    if not recipes:
        return None
    costs = {"food": 0.0, "packaging": 0.0}
    materials = material_lookup()
    for recipe in recipes:
        if recipe.get("channelOnly") and recipe["channelOnly"] != channel:
            continue
        material = materials.get(recipe["materialId"])
        if not material:
            return None
        history = [item for item in material.get("priceHistory", []) if item["effectiveDate"] <= record_date]
        if history:
            price = max(history, key=lambda item: item["effectiveDate"])
            pack_price = float(price["packPrice"])
            pack_quantity = float(price["packQuantity"])
        elif material.get("basePackPrice") and material.get("packQuantity"):
            pack_price = float(material["basePackPrice"])
            pack_quantity = float(material["packQuantity"])
        else:
            return None
        cost_kind = "packaging" if material.get("packaging") else "food"
        costs[cost_kind] += float(recipe["quantity"]) * pack_price / pack_quantity
    return costs


def direct_cost_for_sale(row: sqlite3.Row) -> float | None:
    food = row["food_cost_per_item"]
    packaging = row["packaging_cost_per_item"]
    if food is None or packaging is None:
        return None
    return float(food) * row["quantity"] + float(packaging) * row["quantity"] + row["payment_fee"]


def month_summary(db: sqlite3.Connection, month: str) -> dict:
    sales = db.execute(
        "SELECT * FROM sales WHERE substr(record_date,1,7)=? ORDER BY record_date, created_at", (month,)
    ).fetchall()
    expenses = db.execute(
        "SELECT * FROM expenses WHERE substr(record_date,1,7)=? ORDER BY record_date, created_at", (month,)
    ).fetchall()
    net_sales = sum(row["quantity"] * row["unit_price"] - row["discount_amount"] for row in sales)
    food_cost = 0.0
    packaging_cost = 0.0
    payment_fee = 0
    missing_cost_rows = 0
    for row in sales:
        if row["food_cost_per_item"] is None or row["packaging_cost_per_item"] is None:
            missing_cost_rows += 1
        else:
            food_cost += float(row["food_cost_per_item"]) * row["quantity"]
            packaging_cost += float(row["packaging_cost_per_item"]) * row["quantity"]
        payment_fee += row["payment_fee"]
    common_cost = sum(row["amount"] for row in expenses)
    complete = missing_cost_rows == 0
    direct_cost = food_cost + packaging_cost + payment_fee
    return {
        "month": month,
        "hasData": bool(sales or expenses),
        "hasSales": bool(sales),
        "hasExpenses": bool(expenses),
        "complete": complete and bool(sales),
        "salesCount": len(sales),
        "expenseCount": len(expenses),
        "missingCostRows": missing_cost_rows,
        "netSales": net_sales if sales else None,
        "foodCost": round(food_cost, 2) if complete and sales else None,
        "packagingCost": round(packaging_cost, 2) if complete and sales else None,
        "paymentFee": payment_fee if sales else None,
        "directCost": round(direct_cost, 2) if complete and sales else None,
        "commonCost": common_cost,
        "contribution": round(net_sales - direct_cost, 2) if complete and sales else None,
        "operatingProfit": round(net_sales - direct_cost - common_cost, 2) if complete and sales else None,
    }


def profitability_rows(db: sqlite3.Connection, month: str) -> list[dict]:
    sales = db.execute(
        "SELECT * FROM sales WHERE substr(record_date,1,7)=? ORDER BY record_date, created_at", (month,)
    ).fetchall()
    grouped: dict[tuple[str, str], dict] = {}
    for row in sales:
        key = (row["menu_id"], row["channel"])
        item = grouped.setdefault(key, {
            "menuId": row["menu_id"], "menuName": menu_lookup()[row["menu_id"]]["name"],
            "channel": row["channel"], "quantity": 0, "netSales": 0, "foodCost": 0.0,
            "packagingCost": 0.0, "paymentFee": 0, "missingCostRows": 0,
        })
        item["quantity"] += row["quantity"]
        item["netSales"] += row["quantity"] * row["unit_price"] - row["discount_amount"]
        item["paymentFee"] += row["payment_fee"]
        if row["food_cost_per_item"] is None or row["packaging_cost_per_item"] is None:
            item["missingCostRows"] += 1
        else:
            item["foodCost"] += float(row["food_cost_per_item"]) * row["quantity"]
            item["packagingCost"] += float(row["packaging_cost_per_item"]) * row["quantity"]
    result = []
    for item in grouped.values():
        complete = item["missingCostRows"] == 0
        direct = item["foodCost"] + item["packagingCost"] + item["paymentFee"]
        contribution = item["netSales"] - direct if complete else None
        item.update({
            "foodCost": round(item["foodCost"], 2) if complete else None,
            "packagingCost": round(item["packagingCost"], 2) if complete else None,
            "directCost": round(direct, 2) if complete else None,
            "contribution": round(contribution, 2) if contribution is not None else None,
            "marginPercent": round(contribution / item["netSales"] * 100, 1) if contribution is not None and item["netSales"] > 0 else None,
            "complete": complete,
        })
        result.append(item)
    return sorted(result, key=lambda item: (item["menuName"], item["channel"]))


def inventory_balances(db: sqlite3.Connection, as_of: str) -> list[dict]:
    cutoff = date.fromisoformat(as_of)
    output = []
    recipes = CATALOG.get("recipes", [])
    for material in CATALOG["materials"]:
        baseline = db.execute(
            "SELECT * FROM inventory_events WHERE material_id=? AND event_type='stocktake' AND record_date<=? ORDER BY record_date DESC, created_at DESC LIMIT 1",
            (material["id"], as_of),
        ).fetchone()
        row = {
            "materialId": material["id"], "materialName": material["name"], "unit": material["unit"],
            "lastStocktakeDate": baseline["record_date"] if baseline else None,
            "lastStocktakeQuantity": baseline["quantity"] if baseline else None,
            "balance": None, "salesUsage": 0.0, "restocked": 0.0, "wasted": 0.0,
            "dailyUsage": None, "targetStock": None, "shortage": None, "orderPacks": None,
            "packQuantity": material.get("packQuantity"), "leadDays": material.get("leadDays"),
            "safetyDays": material.get("safetyDays"),
        }
        if not baseline:
            output.append(row)
            continue
        start = baseline["record_date"]
        events = db.execute(
            "SELECT event_type, quantity FROM inventory_events WHERE material_id=? AND record_date>? AND record_date<=?",
            (material["id"], start, as_of),
        ).fetchall()
        current = float(baseline["quantity"])
        for event in events:
            if event["event_type"] == "restock":
                row["restocked"] += float(event["quantity"])
                current += float(event["quantity"])
            elif event["event_type"] == "waste":
                row["wasted"] += float(event["quantity"])
                current -= float(event["quantity"])
        sales = db.execute(
            "SELECT menu_id, channel, quantity FROM sales WHERE record_date>? AND record_date<=?",
            (start, as_of),
        ).fetchall()
        for sale in sales:
            for recipe in recipes:
                if recipe["menuId"] != sale["menu_id"] or recipe["materialId"] != material["id"]:
                    continue
                if recipe.get("channelOnly") and recipe["channelOnly"] != sale["channel"]:
                    continue
                used = float(recipe["quantity"]) * sale["quantity"]
                row["salesUsage"] += used
                current -= used
        elapsed_days = max((cutoff - date.fromisoformat(start)).days, 1)
        daily_usage = row["salesUsage"] / elapsed_days
        lead = int(material.get("leadDays", 0))
        safety = int(material.get("safetyDays", 0))
        target = daily_usage * (lead + safety)
        shortage = max(target - current, 0.0)
        pack_quantity = float(material.get("packQuantity") or 0)
        row.update({
            "balance": round(current, 2), "salesUsage": round(row["salesUsage"], 2),
            "restocked": round(row["restocked"], 2), "wasted": round(row["wasted"], 2),
            "dailyUsage": round(daily_usage, 2), "targetStock": round(target, 2),
            "shortage": round(shortage, 2),
            "orderPacks": math.ceil(shortage / pack_quantity) if shortage > 0 and pack_quantity > 0 else 0,
        })
        output.append(row)
    return output


def sale_json(row: sqlite3.Row) -> dict:
    menu = menu_lookup()[row["menu_id"]]
    gross = row["quantity"] * row["unit_price"]
    return {
        "id": row["id"],
        "date": row["record_date"],
        "menuId": row["menu_id"],
        "menuName": menu["name"],
        "channel": row["channel"],
        "quantity": row["quantity"],
        "unitPrice": row["unit_price"],
        "grossSales": gross,
        "discountAmount": row["discount_amount"],
        "netSales": gross - row["discount_amount"],
        "paymentFee": row["payment_fee"],
        "foodCostPerItem": row["food_cost_per_item"],
        "packagingCostPerItem": row["packaging_cost_per_item"],
        "costSource": row["cost_source"],
    }


def expense_json(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "date": row["record_date"],
        "category": row["category"],
        "amount": row["amount"],
    }


def inventory_json(row: sqlite3.Row) -> dict:
    material = material_lookup()[row["material_id"]]
    return {
        "id": row["id"],
        "date": row["record_date"],
        "materialId": row["material_id"],
        "materialName": material["name"],
        "unit": material["unit"],
        "type": row["event_type"],
        "quantity": row["quantity"],
        "note": row["note"],
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "PrepCafeLocal/1.0"

    def log_message(self, fmt: str, *args: object) -> None:
        # Keep request logs useful without including submitted business data.
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def respond(self, status: int, body: object, extra_headers: list[tuple[str, str]] | None = None) -> None:
        payload = json_bytes(body)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if extra_headers:
            for key, value in extra_headers:
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(payload)

    def read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ApiError("요청 본문을 읽을 수 없습니다.")
        if length <= 0 or length > 1_000_000:
            raise ApiError("입력 자료를 읽을 수 없습니다.")
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ApiError("입력 자료의 형식을 확인해 주세요.")
        if not isinstance(data, dict):
            raise ApiError("입력 자료의 형식을 확인해 주세요.")
        return data

    def cookie_value(self) -> str | None:
        jar = cookies.SimpleCookie()
        try:
            jar.load(self.headers.get("Cookie", ""))
            morsel = jar.get(SESSION_COOKIE)
            return morsel.value if morsel else None
        except cookies.CookieError:
            return None

    def current_operator(self) -> sqlite3.Row | None:
        token = self.cookie_value()
        if not token:
            return None
        now = int(time.time())
        with connect_db() as db:
            row = db.execute(
                "SELECT operator.id, operator.email FROM sessions "
                "JOIN operator ON operator.id = sessions.operator_id "
                "WHERE sessions.token_hash = ? AND sessions.expires_at > ?",
                (session_hash(token), now),
            ).fetchone()
            db.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
            return row

    def set_session(self, db: sqlite3.Connection, operator_id: int) -> str:
        token = secrets.token_urlsafe(32)
        db.execute(
            "INSERT INTO sessions(token_hash, operator_id, expires_at) VALUES (?, ?, ?)",
            (session_hash(token), operator_id, int(time.time()) + SESSION_SECONDS),
        )
        return token

    def cookie_headers(self, token: str, max_age: int = SESSION_SECONDS) -> list[tuple[str, str]]:
        secure = "; Secure" if self.headers.get("X-Forwarded-Proto", "http") == "https" else ""
        return [("Set-Cookie", f"{SESSION_COOKIE}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={max_age}{secure}")]

    def require_operator(self) -> sqlite3.Row:
        operator = self.current_operator()
        if not operator:
            raise ApiError("로그인이 필요합니다.", 401)
        return operator

    def do_GET(self) -> None:
        request = urlparse(self.path)
        path = request.path
        if path.startswith("/api/"):
            try:
                with connect_db() as db:
                    if path == "/api/status":
                        has_operator = db.execute("SELECT 1 FROM operator LIMIT 1").fetchone() is not None
                        operator = self.current_operator()
                        self.respond(200, {"hasOperator": has_operator, "authenticated": operator is not None,
                                           "operator": {"email": operator["email"]} if operator else None,
                                           "catalogSource": CATALOG["source"]})
                        return
                    if path == "/api/catalog":
                        self.respond(200, CATALOG)
                        return
                    self.require_operator()
                    if path == "/api/sales":
                        rows = db.execute("SELECT * FROM sales ORDER BY record_date DESC, created_at DESC").fetchall()
                        self.respond(200, [sale_json(row) for row in rows])
                        return
                    if path == "/api/expenses":
                        rows = db.execute("SELECT * FROM expenses ORDER BY record_date DESC, created_at DESC").fetchall()
                        self.respond(200, [expense_json(row) for row in rows])
                        return
                    if path == "/api/inventory":
                        rows = db.execute("SELECT * FROM inventory_events ORDER BY record_date DESC, created_at DESC").fetchall()
                        self.respond(200, [inventory_json(row) for row in rows])
                        return
                    if path in ("/api/profitability", "/api/pnl"):
                        month = parse_qs(request.query).get("month", [date.today().strftime("%Y-%m")])[0]
                        if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
                            raise ApiError("조회 월은 YYYY-MM 형식으로 선택해 주세요.", field="month")
                        if path == "/api/profitability":
                            self.respond(200, {"month": month, "rows": profitability_rows(db, month)})
                        else:
                            self.respond(200, month_summary(db, month))
                        return
                    if path == "/api/inventory/balance":
                        as_of = parse_qs(request.query).get("asOf", [date.today().isoformat()])[0]
                        valid_date(as_of)
                        self.respond(200, {"asOf": as_of, "rows": inventory_balances(db, as_of)})
                        return
                    raise ApiError("요청한 항목을 찾을 수 없습니다.", 404)
            except ApiError as exc:
                self.respond(exc.status, {"error": str(exc), "field": exc.field})
            except Exception:
                self.respond(500, {"error": "자료를 불러오지 못했습니다. 다시 시도해 주세요."})
            return
        self.serve_static(path)

    def serve_static(self, path: str) -> None:
        if path in ("/", "/index.html"):
            target = WEB / "index.html"
        elif path in ("/app.js", "/styles.css", "/catalog.json"):
            target = WEB / path.lstrip("/")
        else:
            self.send_error(404, "Not Found")
            return
        try:
            payload = target.read_bytes()
        except OSError:
            self.send_error(404, "Not Found")
            return
        mime = MIME_TYPES.get(target.suffix, mimetypes.guess_type(str(target))[0] or "application/octet-stream")
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            data = self.read_json()
            if path == "/api/setup":
                self.setup_operator(data)
                return
            if path == "/api/login":
                self.login(data)
                return
            if path == "/api/logout":
                token = self.cookie_value()
                if token:
                    with connect_db() as db:
                        db.execute("DELETE FROM sessions WHERE token_hash = ?", (session_hash(token),))
                self.respond(200, {"ok": True}, self.cookie_headers("", 0))
                return
            self.require_operator()
            if path == "/api/sales":
                self.save_sale(data)
                return
            if path == "/api/expenses":
                self.save_expense(data)
                return
            if path == "/api/inventory":
                self.save_inventory(data)
                return
            raise ApiError("요청한 항목을 찾을 수 없습니다.", 404)
        except ApiError as exc:
            self.respond(exc.status, {"error": str(exc), "field": exc.field})
        except sqlite3.IntegrityError as exc:
            if "sales.record_date" in str(exc) or "sales.menu_id" in str(exc):
                self.respond(409, {"error": "같은 날짜·메뉴·채널의 판매 기록이 이미 있습니다. 기존 기록을 수정해 주세요.", "field": "menuId"})
            else:
                self.respond(400, {"error": "저장할 수 없는 값입니다. 입력 내용을 확인해 주세요."})
        except Exception:
            self.respond(500, {"error": "저장하지 못했습니다. 입력을 다시 확인해 주세요."})

    def setup_operator(self, data: dict) -> None:
        email = nonempty_text(data.get("email"), "이메일", "email", 254).lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            raise ApiError("올바른 이메일 주소를 입력해 주세요.", field="email")
        password = data.get("password")
        if not isinstance(password, str) or len(password) < 10:
            raise ApiError("비밀번호는 10자 이상으로 입력해 주세요.", field="password")
        salt = secrets.token_bytes(16)
        digest = password_digest(password, salt)
        now = int(time.time())
        with connect_db() as db:
            if db.execute("SELECT 1 FROM operator LIMIT 1").fetchone():
                raise ApiError("운영자 계정이 이미 설정되어 있습니다. 로그인해 주세요.", 409)
            db.execute("INSERT INTO operator(id, email, password_salt, password_hash, created_at) VALUES (1, ?, ?, ?, ?)",
                       (email, salt, digest, now))
            token = self.set_session(db, 1)
        self.respond(200, {"ok": True}, self.cookie_headers(token))

    def login(self, data: dict) -> None:
        email = nonempty_text(data.get("email"), "이메일", "email", 254).lower()
        password = data.get("password")
        if not isinstance(password, str):
            raise ApiError("이메일과 비밀번호를 확인해 주세요.", 401)
        with connect_db() as db:
            row = db.execute("SELECT * FROM operator WHERE email = ?", (email,)).fetchone()
            if not row or not hmac.compare_digest(password_digest(password, row["password_salt"]), row["password_hash"]):
                raise ApiError("이메일 또는 비밀번호가 맞지 않습니다.", 401)
            token = self.set_session(db, row["id"])
        self.respond(200, {"ok": True}, self.cookie_headers(token))

    def sale_payload(self, data: dict) -> tuple:
        record_date = valid_date(data.get("date"))
        menu_id = nonempty_text(data.get("menuId"), "메뉴", "menuId", 20)
        if menu_id not in menu_lookup():
            raise ApiError("목록에서 메뉴를 선택해 주세요.", field="menuId")
        channel = nonempty_text(data.get("channel"), "판매 채널", "channel", 40)
        if channel not in CATALOG["channels"]:
            raise ApiError("목록에서 판매 채널을 선택해 주세요.", field="channel")
        qty = integer(data.get("quantity"), "수량", "quantity")
        price = integer(data.get("unitPrice"), "단가", "unitPrice")
        discount = integer(data.get("discountAmount", 0), "할인 금액", "discountAmount")
        fee = integer(data.get("paymentFee", 0), "결제 수수료", "paymentFee")
        if discount > qty * price:
            raise ApiError("할인 금액은 총매출보다 클 수 없습니다.", field="discountAmount")
        return record_date, menu_id, channel, qty, price, discount, fee

    def save_sale(self, data: dict) -> None:
        record_date, menu_id, channel, qty, price, discount, fee = self.sale_payload(data)
        cost_snapshot = menu_cost_snapshot(menu_id, channel, record_date)
        food_cost = cost_snapshot["food"] if cost_snapshot else None
        packaging_cost = cost_snapshot["packaging"] if cost_snapshot else None
        cost_source = "reference-catalog" if cost_snapshot else None
        now = int(time.time())
        item_id = data.get("id")
        with connect_db() as db:
            if item_id:
                row = db.execute("SELECT 1 FROM sales WHERE id = ?", (item_id,)).fetchone()
                if not row:
                    raise ApiError("수정할 기록을 찾을 수 없습니다. 목록을 새로고침해 주세요.", 404)
                db.execute("UPDATE sales SET record_date=?,menu_id=?,channel=?,quantity=?,unit_price=?,discount_amount=?,payment_fee=?,food_cost_per_item=?,packaging_cost_per_item=?,cost_source=?,updated_at=? WHERE id=?",
                           (record_date, menu_id, channel, qty, price, discount, fee, food_cost, packaging_cost, cost_source, now, item_id))
            else:
                item_id = str(uuid.uuid4())
                db.execute("INSERT INTO sales(id,record_date,menu_id,channel,quantity,unit_price,discount_amount,payment_fee,food_cost_per_item,packaging_cost_per_item,cost_source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                           (item_id, record_date, menu_id, channel, qty, price, discount, fee, food_cost, packaging_cost, cost_source, now, now))
            row = db.execute("SELECT * FROM sales WHERE id = ?", (item_id,)).fetchone()
        self.respond(200, sale_json(row))

    def save_expense(self, data: dict) -> None:
        record_date = valid_date(data.get("date"))
        category = nonempty_text(data.get("category"), "비용 항목", "category", 100)
        if category not in CATALOG["expense_categories"]:
            raise ApiError("목록에서 비용 항목을 선택해 주세요.", field="category")
        amount = integer(data.get("amount"), "금액", "amount")
        now = int(time.time())
        item_id = data.get("id")
        with connect_db() as db:
            if item_id:
                row = db.execute("SELECT 1 FROM expenses WHERE id = ?", (item_id,)).fetchone()
                if not row:
                    raise ApiError("수정할 기록을 찾을 수 없습니다. 목록을 새로고침해 주세요.", 404)
                db.execute("UPDATE expenses SET record_date=?,category=?,amount=?,updated_at=? WHERE id=?",
                           (record_date, category, amount, now, item_id))
            else:
                item_id = str(uuid.uuid4())
                db.execute("INSERT INTO expenses(id,record_date,category,amount,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                           (item_id, record_date, category, amount, now, now))
            row = db.execute("SELECT * FROM expenses WHERE id = ?", (item_id,)).fetchone()
        self.respond(200, expense_json(row))

    def save_inventory(self, data: dict) -> None:
        record_date = valid_date(data.get("date"))
        material_id = nonempty_text(data.get("materialId"), "재료", "materialId", 20)
        if material_id not in material_lookup():
            raise ApiError("목록에서 재료를 선택해 주세요.", field="materialId")
        event_type = nonempty_text(data.get("type"), "기록 유형", "type", 20)
        if event_type not in ("restock", "waste", "stocktake"):
            raise ApiError("입고, 폐기, 실사 중 하나를 선택해 주세요.", field="type")
        qty = quantity(data.get("quantity"), "수량", "quantity", allow_fraction=True)
        note = data.get("note", "")
        if not isinstance(note, str) or len(note) > 300:
            raise ApiError("메모는 300자 이내로 입력해 주세요.", field="note")
        now = int(time.time())
        item_id = data.get("id")
        with connect_db() as db:
            if item_id:
                row = db.execute("SELECT 1 FROM inventory_events WHERE id = ?", (item_id,)).fetchone()
                if not row:
                    raise ApiError("수정할 기록을 찾을 수 없습니다. 목록을 새로고침해 주세요.", 404)
                db.execute("UPDATE inventory_events SET record_date=?,material_id=?,event_type=?,quantity=?,note=?,updated_at=? WHERE id=?",
                           (record_date, material_id, event_type, qty, note.strip(), now, item_id))
            else:
                item_id = str(uuid.uuid4())
                db.execute("INSERT INTO inventory_events(id,record_date,material_id,event_type,quantity,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
                           (item_id, record_date, material_id, event_type, qty, note.strip(), now, now))
            row = db.execute("SELECT * FROM inventory_events WHERE id = ?", (item_id,)).fetchone()
        self.respond(200, inventory_json(row))

    def do_PUT(self) -> None:
        path = urlparse(self.path).path.rstrip("/")
        try:
            self.require_operator()
            data = self.read_json()
            if path == "/api/sales":
                if not data.get("id"):
                    raise ApiError("수정할 기록이 없습니다.")
                self.save_sale(data)
                return
            if path == "/api/expenses":
                if not data.get("id"):
                    raise ApiError("수정할 기록이 없습니다.")
                self.save_expense(data)
                return
            if path == "/api/inventory":
                if not data.get("id"):
                    raise ApiError("수정할 기록이 없습니다.")
                self.save_inventory(data)
                return
            raise ApiError("요청한 항목을 찾을 수 없습니다.", 404)
        except ApiError as exc:
            self.respond(exc.status, {"error": str(exc), "field": exc.field})
        except sqlite3.IntegrityError:
            self.respond(409, {"error": "같은 날짜·메뉴·채널의 판매 기록이 이미 있습니다. 기존 기록을 수정해 주세요.", "field": "menuId"})
        except Exception:
            self.respond(500, {"error": "수정하지 못했습니다. 다시 시도해 주세요."})

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path.rstrip("/")
        try:
            self.require_operator()
            pieces = path.split("/")
            if len(pieces) != 4 or pieces[1] != "api" or pieces[2] not in ("sales", "expenses", "inventory"):
                raise ApiError("요청한 항목을 찾을 수 없습니다.", 404)
            table = {"sales": "sales", "expenses": "expenses", "inventory": "inventory_events"}[pieces[2]]
            with connect_db() as db:
                cursor = db.execute(f"DELETE FROM {table} WHERE id = ?", (pieces[3],))
            if cursor.rowcount == 0:
                raise ApiError("삭제할 기록을 찾을 수 없습니다.", 404)
            self.respond(200, {"ok": True})
        except ApiError as exc:
            self.respond(exc.status, {"error": str(exc), "field": exc.field})
        except Exception:
            self.respond(500, {"error": "삭제하지 못했습니다. 다시 시도해 주세요."})

    def do_HEAD(self) -> None:
        if urlparse(self.path).path in ("/", "/index.html"):
            self.send_response(200)
            self.end_headers()
        else:
            self.send_error(404, "Not Found")


if __name__ == "__main__":
    initialize_db()
    host = os.environ.get("PREP_HOST", "127.0.0.1")
    port = int(os.environ.get("PREP_PORT", "8765"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Prep Cafe local app: http://{host}:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
