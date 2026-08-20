"""
USBank Risk Management AI - Bank Fraud Risk Investigation Engine
Backend Server (app.py) using Flask, SQLite3, ChromaDB RAG, PyPDF, and Gemini/OpenAI integration.
Uses US_Bank_Sample_Risk_Policy.pdf directly as the authoritative policy document.
"""

import os
import sqlite3
import json
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
import chromadb
from chromadb import EmbeddingFunction
from pypdf import PdfReader

load_dotenv()

DB_PATH = "mock_data.db"
PDF_PATH = "US_Bank_Sample_Risk_Policy.pdf"
CHROMA_DIR = "./chroma_db"

app = Flask(__name__, static_folder="static")

# Custom lightweight offline embedding function for ChromaDB
class SimpleHashEmbeddingFunction(EmbeddingFunction):
    def __init__(self):
        pass

    def __call__(self, input: list) -> list:
        embeddings = []
        for text in input:
            vec = [0.0] * 64
            for word in str(text).lower().split():
                idx = abs(hash(word)) % 64
                vec[idx] += 1.0
            norm = sum(x**2 for x in vec) ** 0.5 or 1.0
            embeddings.append([x / norm for x in vec])
        return embeddings

# ==========================================
# 1. Database Initialization & Seeding
# ==========================================
def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS customer_profiles (
        user_id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        home_country TEXT NOT NULL,
        avg_monthly_spent REAL NOT NULL,
        avg_transaction_amt REAL NOT NULL
    )
    """)
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS transactions (
        transaction_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        amount REAL NOT NULL,
        merchantname TEXT NOT NULL,
        location TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        card_present TEXT NOT NULL,
        ip_address TEXT NOT NULL,
        ip_is_proxy INTEGER NOT NULL,
        card_status TEXT NOT NULL DEFAULT 'active',
        transaction_status BOOLEAN NOT NULL DEFAULT 0,
        escalated INTEGER NOT NULL DEFAULT 0,
        notified INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES customer_profiles (user_id)
    )
    """)

    transaction_columns = {
        column[1] for column in cursor.execute("PRAGMA table_info(transactions)")
    }
    if "transaction_status" not in transaction_columns:
        cursor.execute(
            "ALTER TABLE transactions ADD COLUMN transaction_status BOOLEAN NOT NULL DEFAULT 0"
        )
    
    customer_profiles = [
        ('USR_402', 'Alice Morgan', 'USA', 3500.00, 85.00),
        ('USR_101', 'Bob Jones', 'USA', 2100.00, 45.00),
        ('USR_303', 'Charlie Brown', 'USA', 5400.00, 250.00),
        ('USR_504', 'Diana Patel', 'USA', 4200.00, 160.00),
        ('USR_605', 'Ethan Wilson', 'Canada', 2800.00, 110.00),
    ]
    cursor.executemany(
        "INSERT OR REPLACE INTO customer_profiles VALUES (?, ?, ?, ?, ?)",
        customer_profiles,
    )

    transactions = [
        # Alice Morgan (USR_402) - Active high-risk & multi-txn history
        ('TXN_99812', 'USR_402', 1450.00, 'Luxury Watch Vault', 'UK', '2026-08-19 13:00:00', 'yes', '185.220.101.4', 1, 'active',0, 0, 0),
        ('TXN_998112', 'USR_402', 42.00, 'Amazon.com', 'USA', '2026-08-19 12:00:00', 'no', '192.168.1.100', 0, 'active',1, 0, 0),
        ('TXN_998101', 'USR_402', 89.50, 'Whole Foods Market', 'USA', '2026-08-18 17:45:00', 'yes', '192.168.1.100', 0, 'active',1, 0, 0),
        ('TXN_998102', 'USR_402', 120.00, 'Shell Gas Station', 'USA', '2026-08-18 08:30:00', 'yes', '192.168.1.100', 0, 'active',1, 0, 0),
        ('TXN_998103', 'USR_402', 54.20, 'Starbucks Coffee', 'USA', '2026-08-17 09:15:00', 'yes', '192.168.1.100', 0, 'active',1, 0, 0),

        # Bob Jones (USR_101) - Routine low-risk purchases
        ('TXN_99816', 'USR_101', 72.00, 'Coffee House', 'USA', '2026-08-19 10:05:00', 'yes', '98.210.33.5', 0, 'active',1, 0, 0),
        ('TXN_99814', 'USR_101', 38.00, 'Local Grocery', 'USA', '2026-08-19 09:15:00', 'yes', '98.210.33.5', 0, 'active',1, 0, 0),
        ('TXN_998120', 'USR_101', 45.00, 'BP Gas Station', 'USA', '2026-08-18 14:10:00', 'yes', '98.210.33.5', 0, 'active',1, 0, 0),
        ('TXN_998121', 'USR_101', 115.00, 'Walmart Supercenter', 'USA', '2026-08-17 18:20:00', 'yes', '98.210.33.5', 0, 'active',1, 0, 0),
        ('TXN_998122', 'USR_101', 29.99, 'Netflix Subscription', 'USA', '2026-08-16 00:01:00', 'no', '98.210.33.5', 0, 'active', 1, 0, 0),

        # Charlie Brown (USR_303) - Medium & high risk proxy spikes
        ('TXN_99815', 'USR_303', 3500.00, 'Crypto Exchange', 'Romania', '2026-08-19 14:20:00', 'no', '194.26.29.112', 1, 'active',0, 0, 0),
        ('TXN_998130', 'USR_303', 210.00, 'Best Buy Electronics', 'USA', '2026-08-18 11:30:00', 'yes', '73.18.29.4', 0, 'active',1, 0, 0),
        ('TXN_998131', 'USR_303', 185.00, 'Home Depot', 'USA', '2026-08-17 15:40:00', 'yes', '73.18.29.4', 0, 'active',1, 0, 0),
        ('TXN_998132', 'USR_303', 62.40, 'Chevron Gas', 'USA', '2026-08-16 08:12:00', 'yes', '73.18.29.4', 0, 'active', 1,0, 0),
        ('TXN_998133', 'USR_303', 450.00, 'Apple Store Online', 'USA', '2026-08-15 19:05:00', 'no', '73.18.29.4', 0,1, 'active', 0, 0),

        # Diana Patel (USR_504) - Amount anomalies
        ('TXN_99817', 'USR_504', 950.00, 'Online Electronics', 'USA', '2026-08-19 15:10:00', 'no', '73.44.18.20', 0, 'active',1, 0, 0),
        ('TXN_998140', 'USR_504', 145.00, 'Sephora Beauty', 'USA', '2026-08-18 13:25:00', 'yes', '73.44.18.20', 0, 'active',1,0, 0),
        ('TXN_998141', 'USR_504', 82.10, "Trader Joe's", 'USA', '2026-08-17 16:50:00', 'yes', '73.44.18.20', 0, 'active',1, 0, 0),
        ('TXN_998142', 'USR_504', 190.00, 'Nordstrom Department', 'USA', '2026-08-16 11:15:00', 'yes', '73.44.18.20', 0, 'active',1, 0, 0),
        ('TXN_998143', 'USR_504', 35.00, 'Uber Ride Share', 'USA', '2026-08-15 22:40:00', 'no', '73.44.18.20', 0, 'active',1, 0, 0),

        # Ethan Wilson (USR_605) - International proxy & local transactions
        ('TXN_99818', 'USR_605', 1800.00, 'Luxury Goods Online', 'France', '2026-08-19 16:25:00', 'no', '185.220.101.8', 1, 'active',0, 0, 0),
        ('TXN_99819', 'USR_605', 65.00, 'Canadian Market', 'Canada', '2026-08-19 12:25:00', 'yes', '24.150.12.8', 0, 'active',1, 0, 0),
        ('TXN_998150', 'USR_605', 125.00, 'Tim Hortons Coffee', 'Canada', '2026-08-18 07:40:00', 'yes', '24.150.12.8', 0, 'active',1, 0, 0),
        ('TXN_998151', 'USR_605', 340.00, 'Air Canada Booking', 'Canada', '2026-08-17 14:15:00', 'no', '24.150.12.8', 0, 'active',1, 0, 0),
        ('TXN_998152', 'USR_605', 95.50, 'Shoppers Drug Mart', 'Canada', '2026-08-16 18:30:00', 'yes', '24.150.12.8', 0, 'active',1, 0, 0),
    ]
    cursor.executemany(
        """
        INSERT OR REPLACE INTO transactions (
            transaction_id, user_id, amount, merchantname, location, timestamp,
            card_present, ip_address, ip_is_proxy, card_status,
            transaction_status, escalated, notified
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        transactions,
    )
    
    conn.commit()
    conn.close()
    print("[INIT] SQLite database 'mock_data.db' initialized & seeded.")

# ==========================================
# 2. ChromaDB RAG Indexing from PDF
# ==========================================
def init_chroma_rag():
    if not os.path.exists(PDF_PATH):
        raise FileNotFoundError(f"Policy document '{PDF_PATH}' not found in directory.")

    # Parse US_Bank_Sample_Risk_Policy.pdf using PyPDF
    reader = PdfReader(PDF_PATH)
    raw_text_by_page = []
    for i, page in enumerate(reader.pages):
        raw_text_by_page.append(page.extract_text())
        
    print(f"[INIT] Loaded '{PDF_PATH}' ({len(reader.pages)} pages extracted via pypdf).")

    client = chromadb.PersistentClient(path=CHROMA_DIR)
    embed_fn = SimpleHashEmbeddingFunction()
    
    try:
        client.delete_collection(name="us_bank_risk_policies")
    except Exception:
        pass

    collection = client.get_or_create_collection(name="us_bank_risk_policies", embedding_function=embed_fn)
    
    # Chunk text from US_Bank_Sample_Risk_Policy.pdf
    docs = []
    ids = []
    metadatas = []
    
    chunk_counter = 1
    for p_idx, page_text in enumerate(raw_text_by_page):
        page_num = p_idx + 1
        paragraphs = page_text.split('\n\n')
        for para in paragraphs:
            clean_p = para.strip()
            if len(clean_p) > 50:
                # Infer section tag from text
                section_tag = "Section Policy"
                if "4.2" in clean_p or "Impossible Travel" in clean_p:
                    section_tag = "Section 4.2"
                elif "5.3" in clean_p or "Anonymizing Proxies" in clean_p:
                    section_tag = "Section 5.3"
                elif "6." in clean_p or "Behavioral Anomalies" in clean_p or "Unusual Amount" in clean_p:
                    section_tag = "Section 6.2"
                elif "7." in clean_p or "Scoring" in clean_p:
                    section_tag = "Section 7"
                elif "8.1" in clean_p or "High-Risk" in clean_p:
                    section_tag = "Section 8.1"
                
                docs.append(clean_p)
                ids.append(f"usbank_p{page_num}_c{chunk_counter}")
                metadatas.append({"page": page_num, "section": section_tag, "source": PDF_PATH})
                chunk_counter += 1

    collection.add(documents=docs, ids=ids, metadatas=metadatas)
    print(f"[INIT] ChromaDB populated with {len(docs)} policy chunks from '{PDF_PATH}'.")
    return collection

# Initialize resources on module load
init_db()
chroma_collection = init_chroma_rag()

# ==========================================
# 3. LLM Handler (Gemini / OpenAI / Fallback)
# ==========================================
last_llm_provider = "fallback"

def generate_llm_summary(prompt, target_txn_id, risk_score):
    global last_llm_provider
    last_llm_provider = "fallback"

    # 1. Try Gemini
    gemini_key = os.environ.get("GEMINI_API_KEY")
    if gemini_key:
        try:
            print("[LLM] Calling Gemini API")
            last_llm_provider = "gemini"
            import google.generativeai as genai
            genai.configure(api_key=gemini_key)
            model = genai.GenerativeModel('gemini-1.5-flash')
            res = model.generate_content(prompt)
            if res.text:
                return res.text
        except Exception as e:
            print(f"[LLM] Gemini Error: {e}")

    # 2. Try OpenAI
    openai_key = os.environ.get("OPENAI_API_KEY")
    if openai_key:
        try:
            print("[LLM] Calling OpenAI API")
            last_llm_provider = "openai"
            import openai
            client = openai.OpenAI(api_key=openai_key)
            res = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "system", "content": "You are USBank Risk Management AI, a Senior Fraud Investigation Agent grounding answers in U.S. Bank Fraud Risk Policy."},
                          {"role": "user", "content": prompt}]
            )
            return res.choices[0].message.content
        except Exception as e:
            print(f"[LLM] OpenAI Error: {e}")

    print("[LLM] Using deterministic fallback; no successful provider response")

    # 3. Deterministic fallback grounded in the calculated score and policy.
    if risk_score >= 80:
        risk_level = "HIGH RISK"
        action = "Immediate Card Freeze Required"
    elif risk_score >= 40:
        risk_level = "MEDIUM RISK"
        action = "Secondary Fraud Review Required"
    else:
        risk_level = "LOW RISK"
        action = "No Action Required - Normal Transaction"

    return (
        f"EXECUTIVE SUMMARY: Risk score assessed at {risk_score}/100 ({risk_level}). "
        f"Transaction {target_txn_id} was evaluated against the transaction data, customer history, "
        f"and US_Bank_Sample_Risk_Policy.pdf. Required action: {action}."
    )


def evaluate_transaction_risk(txn, customer, history):
    """Calculate risk from transaction and customer data instead of its ID."""
    score = 10
    findings = []
    average_amount = customer.get("avg_transaction_amt", 0) or 0
    amount_ratio = txn["amount"] / average_amount if average_amount else 0

    if amount_ratio >= 10:
        score += 25
        findings.append({
            "title": "Extreme Spending Anomaly",
            "severity": "HIGH",
            "policy_tag": "Section 6.2",
            "description": f"Transaction amount (${txn['amount']:.2f}) is {amount_ratio:.1f}x the customer's average transaction amount.",
        })
    elif amount_ratio >= 5:
        score += 18
        findings.append({
            "title": "Significant Spending Anomaly",
            "severity": "MEDIUM",
            "policy_tag": "Section 6.2",
            "description": f"Transaction amount (${txn['amount']:.2f}) is {amount_ratio:.1f}x the customer's average transaction amount.",
        })
    elif amount_ratio >= 2:
        score += 10
        findings.append({
            "title": "Unusual Spending Amount",
            "severity": "MEDIUM",
            "policy_tag": "Section 6.2",
            "description": f"Transaction amount (${txn['amount']:.2f}) is {amount_ratio:.1f}x the customer's average transaction amount.",
        })

    if txn["ip_is_proxy"]:
        proxy_points = 30 if txn["amount"] > 500 else 15
        score += proxy_points
        findings.append({
            "title": "Anonymizing Proxy IP Detected",
            "severity": "HIGH" if txn["amount"] > 500 else "MEDIUM",
            "policy_tag": "Section 5.3",
            "description": f"Transaction originated from a proxy IP; amount ${txn['amount']:.2f} {'exceeds' if txn['amount'] > 500 else 'does not exceed'} the $500 policy threshold.",
        })

    if txn["location"] != customer.get("home_country"):
        score += 10
        findings.append({
            "title": "International Transaction",
            "severity": "MEDIUM",
            "policy_tag": "Section 4.2",
            "description": f"Transaction location ({txn['location']}) differs from the customer's home country ({customer.get('home_country')}).",
        })

    if txn["card_present"] == "no":
        score += 5

    current_time = datetime.fromisoformat(txn["timestamp"])
    has_impossible_travel = any(
        other["transaction_id"] != txn["transaction_id"]
        and other["location"] != txn["location"]
        and txn["card_present"] == "yes"
        and other["card_present"] == "no"
        and abs((current_time - datetime.fromisoformat(other["timestamp"])).total_seconds()) <= 7200
        for other in history
    )
    if has_impossible_travel:
        score += 70
        findings.append({
            "title": "Impossible Travel Velocity",
            "severity": "CRITICAL",
            "policy_tag": "Section 4.2",
            "description": "A card-present transaction occurred in a different location within two hours of this transaction.",
        })

    risk_score = min(score, 100)
    if risk_score >= 80:
        risk_level = "High"
        required_action = "Immediate Card Freeze Required"
    elif risk_score >= 40:
        risk_level = "Medium"
        required_action = "Secondary Fraud Review Required"
    else:
        risk_level = "Low"
        required_action = "No Action Required - Normal Transaction"

    if not findings:
        findings = [{
            "title": "No Significant Risk Indicators",
            "severity": "LOW",
            "policy_tag": "Section 7",
            "description": "The transaction is within normal spending and location patterns with no proxy indicator.",
        }]

    return risk_score, risk_level, required_action, findings

# ==========================================
# 4. API Endpoints
# ==========================================
@app.after_request
def add_header(response):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

@app.route("/")
def serve_index():
    return send_from_directory("static", "index.html")

@app.route("/static/<path:filename>")
def serve_static(filename):
    return send_from_directory("static", filename)

@app.route("/api/transactions", methods=["GET"])
def get_transactions():
    search_query = request.args.get("q", "").strip().lower()
    filter_type = request.args.get("filter", "all").strip().lower()
    
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    query = """
    SELECT 
        t.transaction_id,
        t.user_id,
        t.amount,
        t.merchantname,
        t.location,
        t.timestamp,
        t.card_present,
        t.ip_address,
        t.ip_is_proxy,
        t.card_status,
        t.transaction_status,
        t.escalated,
        t.notified,
        c.full_name,
        c.home_country,
        c.avg_monthly_spent,
        c.avg_transaction_amt
    FROM transactions t
    LEFT JOIN customer_profiles c ON t.user_id = c.user_id
    ORDER BY t.timestamp DESC
    """
    
    cursor.execute(query)
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()

    # Pre-group history for risk evaluation
    history_by_user = {}
    for r in rows:
        uid = r["user_id"]
        if uid not in history_by_user:
            history_by_user[uid] = []
        history_by_user[uid].append(r)
    
    filtered_results = []
    for r in rows:
        user_id = r["user_id"]
        customer = {
            "user_id": user_id,
            "full_name": r.get("full_name"),
            "home_country": r.get("home_country"),
            "avg_monthly_spent": r.get("avg_monthly_spent"),
            "avg_transaction_amt": r.get("avg_transaction_amt"),
        }
        history = history_by_user.get(user_id, [])

        score, level, action, findings = evaluate_transaction_risk(r, customer, history)
        r["risk_score"] = score
        r["risk_level"] = level  # "High", "Medium", "Low"
        r["risk_color"] = "red" if level == "High" else ("yellow" if level == "Medium" else "green")
        r["required_action"] = action

        is_proxy = bool(r.get("ip_is_proxy"))
        is_frozen = r.get("card_status") == "frozen"
        
        if filter_type == "high" and level != "High":
            continue
        if filter_type == "medium" and level != "Medium":
            continue
        if filter_type == "low" and level != "Low":
            continue
        if filter_type == "proxy" and not is_proxy:
            continue
        if filter_type == "frozen" and not is_frozen:
            continue
            
        if search_query:
            match = (
                search_query in r["transaction_id"].lower()
                or search_query in r["user_id"].lower()
                or search_query in (r.get("full_name") or "").lower()
                or search_query in r["merchantname"].lower()
                or search_query in r["location"].lower()
                or search_query in level.lower()
                or search_query in str(r["amount"])
            )
            if not match:
                continue
                
        filtered_results.append(r)
        
    return jsonify({"transactions": filtered_results, "total": len(filtered_results)})

@app.route("/api/investigate/<transaction_id>", methods=["GET"])
def investigate(transaction_id):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Tool Call 1: Fetch transaction
    cursor.execute("SELECT * FROM transactions WHERE transaction_id = ?", (transaction_id,))
    txn_row = cursor.fetchone()
    
    if not txn_row:
        conn.close()
        return jsonify({"error": f"Transaction '{transaction_id}' not found."}), 404
        
    txn = dict(txn_row)
    user_id = txn["user_id"]
    
    # Tool Call 2: Fetch customer profile
    cursor.execute("SELECT * FROM customer_profiles WHERE user_id = ?", (user_id,))
    customer_row = cursor.fetchone()
    customer = dict(customer_row) if customer_row else {}
    
    # Tool Call 3: Fetch transaction history
    cursor.execute("SELECT * FROM transactions WHERE user_id = ? ORDER BY timestamp DESC", (user_id,))
    history = [dict(r) for r in cursor.fetchall()]
    conn.close()
    
    # Execution Trace Logs
    trace = [
        f"[AGENT INITIALIZATION] Initialized USBank Risk Management AI Fraud Engine for Transaction ID: {transaction_id}",
        f"[TOOL CALL] Executing SQLite query: SELECT * FROM transactions WHERE transaction_id = '{transaction_id}'",
        f"[TOOL CALL] Executing SQLite query: SELECT * FROM customer_profiles WHERE user_id = '{user_id}'",
        f"[TOOL CALL] Executing SQLite query: SELECT * FROM transactions WHERE user_id = '{user_id}'",
        f"[RAG INDEX] Querying ChromaDB collection 'us_bank_risk_policies' (Parsed from {PDF_PATH})...",
    ]
    
    # RAG Vector Search in ChromaDB
    rag_query = f"{txn['location']} card_present {txn['card_present']} proxy {txn['ip_is_proxy']} amount {txn['amount']} velocity continent tor exit node"
    rag_res = chroma_collection.query(query_texts=[rag_query], n_results=3)
    
    citations = []
    matched_docs = rag_res.get("documents", [[]])[0]
    matched_metas = rag_res.get("metadatas", [[]])[0]
    matched_distances = rag_res.get("distances", [[]])[0]

    section_titles = {
        "Section 4.2": "Impossible Travel Velocity",
        "Section 5.3": "Anonymizing Proxies",
        "Section 7": "Risk Scoring and Classification",
        "Section 8.1": "High-Risk Action Rule",
        "Section Policy": "U.S. Bank Risk Policy",
    }

    retrieved_citations = []
    for index, document in enumerate(matched_docs):
        metadata = matched_metas[index] if index < len(matched_metas) else {}
        distance = matched_distances[index] if index < len(matched_distances) else 0
        section = metadata.get("section", "Section Policy")
        retrieved_citations.append({
            "section": section,
            "title": section_titles.get(section, "Policy Rule"),
            "match_score": round(100 / (1 + max(distance, 0)), 1),
            "text": document,
            "source": metadata.get("source", PDF_PATH),
            "page": metadata.get("page"),
        })
    
    # Ground citations directly from US_Bank_Sample_Risk_Policy.pdf
    default_citations_high = [
        {
            "section": "Section 4.2",
            "title": "Impossible Travel Velocity",
            "match_score": 95.8,
            "text": "POLICY TRIGGER - SECTION 4.2: Any Card-Not-Present (CNP) transaction occurring within 2 hours of a physical card swipe in a different geographical continent must be treated as an Impossible Travel Velocity event and routed for elevated fraud review."
        },
        {
            "section": "Section 5.3",
            "title": "Anonymizing Proxies",
            "match_score": 92.4,
            "text": "POLICY TRIGGER - SECTION 5.3: Transactions originating from known Tor exit nodes or proxy IPs carrying an amount higher than $500 trigger mandatory secondary fraud review."
        },
        {
            "section": "Section 8.1",
            "title": "High-Risk Action Rule",
            "match_score": 89.1,
            "text": "HIGH-RISK ACTION RULE: When the approved risk assessment classifies an investigation as High Risk (risk level greater than 80), the required action is Immediate Card Freeze."
        }
    ]

    default_citations_low = [
        {
            "section": "Section 7",
            "title": "Risk Scoring and Classification",
            "match_score": 88.0,
            "text": "Low Risk Range 0-39: Routine monitoring or closure when no policy trigger exists."
        },
        {
            "section": "Section 5.4",
            "title": "Proxy Exceptions",
            "match_score": 82.5,
            "text": "Section 5.4: A transaction below or equal to $500 does not meet the amount threshold in Section 5.3."
        }
    ]

    if retrieved_citations:
        citations = retrieved_citations
    else:
        citations = default_citations_low

    for c in citations:
        trace.append(f"[RAG MATCH] Grounded {c['section']} ({c['title']}) - Match: {c['match_score']}%")
        
    trace.append(f"[LLM PROMPT] Assembling evidence context (DB records + RAG chunks from {PDF_PATH})...")
    
    # Evaluate Risk Score & Findings from transaction values.
    risk_score, risk_level, required_action, findings = evaluate_transaction_risk(
        txn, customer, history
    )

    prompt = (
        f"Target Transaction: {txn}\n"
        f"Customer Profile: {customer}\n"
        f"User History: {history}\n"
        f"U.S. Bank Policy Chunks: {[c['text'] for c in citations]}\n"
        "Provide a concise executive fraud risk investigation summary."
    )

    trace.append("[LLM INFERENCE] Executing LLM synthesis & executive summary generation...")
    llm_summary = generate_llm_summary(prompt, transaction_id, risk_score)
    trace.append(f"[VERDICT GENERATED] Fraud Risk Score: {risk_score}/100 ({risk_level} Risk). Action: {required_action}.")

    response_payload = {
        "transaction_id": transaction_id,
        "user_id": user_id,
        "risk_score": risk_score,
        "risk_level": risk_level,
        "required_action": required_action,
        "customer": customer,
        "transaction": txn,
        "user_history": history,
        "execution_trace": trace,
        "findings": findings,
        "policy_citations": citations,
        "llm_provider": last_llm_provider,
        "llm_summary": llm_summary
    }
    
    return jsonify(response_payload)

@app.route("/api/action", methods=["POST"])
def perform_action():
    data = request.get_json() or {}
    action = data.get("action")
    transaction_id = data.get("transaction_id", "TXN_99812")
    
    if not action or action not in ["freeze", "notify", "escalate"]:
        return jsonify({"error": "Invalid action parameter. Expected 'freeze', 'notify', or 'escalate'."}), 400
        
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    if action == "freeze":
        cursor.execute("UPDATE transactions SET card_status = 'frozen' WHERE transaction_id = ?", (transaction_id,))
        msg = f"Card associated with transaction {transaction_id} has been FROZEN instantly."
    elif action == "notify":
        cursor.execute("UPDATE transactions SET notified = 1 WHERE transaction_id = ?", (transaction_id,))
        msg = f"Automated Fraud Alert SMS & Email sent to customer for transaction {transaction_id}."
    elif action == "escalate":
        cursor.execute("UPDATE transactions SET escalated = 1 WHERE transaction_id = ?", (transaction_id,))
        msg = f"Case {transaction_id} escalated to Senior Fraud Analyst queue."
        
    conn.commit()
    
    cursor.execute("SELECT card_status, notified, escalated FROM transactions WHERE transaction_id = ?", (transaction_id,))
    row = cursor.fetchone()
    conn.close()
    
    updated_status = {
        "card_status": row[0] if row else "unknown",
        "notified": bool(row[1]) if row else False,
        "escalated": bool(row[2]) if row else False
    }
    
    return jsonify({
        "success": True,
        "action": action,
        "message": msg,
        "updated_status": updated_status
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
