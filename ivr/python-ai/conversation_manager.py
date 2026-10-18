"""
Conversation session manager for multi-turn IVR.
Manages per-call state using in-memory storage.

TODO: For production, replace with Redis to support:
- Multiple server instances
- Session persistence across server restarts
- Automatic session expiry
- Call state recovery
"""

import json
import os
import time
import threading
from typing import Optional, Dict, Any


# In-memory session storage
# Key: session_id (Exotel stream_sid)
# Value: session dict (with "last_activity" timestamp)
_sessions: Dict[str, Dict] = {}

# Session TTL: 30 minutes (1800 seconds)
SESSION_TTL_SECONDS = 1800

# NOTE: For production with multiple servers, use Redis:
# import redis
# _redis_client = redis.Redis(host='localhost', port=6379, db=0)
# NOTE: For production, add threading.Lock() for thread-safe dict access


def _start_cleanup_task():
    """Start background task to clean up stale sessions."""
    def cleanup_loop():
        while True:
            time.sleep(300)  # Check every 5 minutes
            _cleanup_stale_sessions()
    
    thread = threading.Thread(target=cleanup_loop, daemon=True)
    thread.start()
    print(f"[ConversationManager] Started session cleanup task (TTL: {SESSION_TTL_SECONDS}s)")


def _cleanup_stale_sessions():
    """Remove sessions that exceeded TTL."""
    now = time.time()
    stale_ids = []
    
    for session_id, session in _sessions.items():
        last_activity = session.get("last_activity", 0)
        if now - last_activity > SESSION_TTL_SECONDS:
            stale_ids.append(session_id)
    
    for session_id in stale_ids:
        del _sessions[session_id]
        print(f"[ConversationManager] Cleaned up stale session: {session_id}")


# Start cleanup task on module load
_start_cleanup_task()


def create_session(session_id: str, language: str = "hi") -> Dict:
    """
    Create a new conversation session.
    
    Session structure:
    {
        "session_id": str,
        "language": str,
        "intent": Optional[str],
        "flow_name": Optional[str],
        "conversation_stage": str,  # "intent_detection", "collecting_info", "complete"
        "current_question_index": int,
        "user_profile": dict,
        "candidate_schemes": [],
"missing_fields": [],
"current_field": None,
        "validation_attempt_count": int,  # 0-indexed: 0, 1, 2 = 3 total attempts before skip
        "last_activity": float  # Unix timestamp for TTL tracking
    }
    """
    session = {
        "session_id": session_id,
        "language": language,
        "intent": None,
        "flow_name": None,
        "conversation_stage": "intent_detection",
        "current_question_index": 0,
        "user_profile": {},
        "validation_attempt_count": 0,
        "last_activity": time.time()
    }
    
    _sessions[session_id] = session
    
    print(f"[ConversationManager] Created session: {session_id}")
    
    return session


def get_session(session_id: str) -> Optional[Dict]:
    """
    Retrieve session by ID.
    Updates last_activity timestamp.
    Returns None if session doesn't exist.
    """
    session = _sessions.get(session_id)
    if session:
        session["last_activity"] = time.time()
    return session


def update_session(session_id: str, updates: Dict) -> bool:
    """
    Update session with new data.
    Updates last_activity timestamp.
    Returns True if session exists, False otherwise.
    """
    if session_id not in _sessions:
        return False
    
    _sessions[session_id].update(updates)
    _sessions[session_id]["last_activity"] = time.time()
    return True


def update_profile(session_id: str, field: str, value: Any) -> bool:
    """
    Update a specific field in user_profile.
    Returns True if session exists, False otherwise.
    """
    if session_id not in _sessions:
        return False
    
    _sessions[session_id]["user_profile"][field] = value
    
    print(f"[ConversationManager] Updated profile field '{field}' = {value} for session {session_id}")
    
    return True


def clear_session(session_id: str) -> bool:
    """
    Remove session from memory.
    Returns True if session existed, False otherwise.
    """
    if session_id in _sessions:
        del _sessions[session_id]
        print(f"[ConversationManager] Cleared session: {session_id}")
        return True
    return False


def get_all_sessions() -> Dict[str, Dict]:
    """
    Get all active sessions (for debugging/monitoring).
    """
    return _sessions.copy()


def get_session_count() -> int:
    """
    Get count of active sessions.
    """
    return len(_sessions)
