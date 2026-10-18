from question_generator import generate_question


# Questions asked during Government Scheme onboarding
QUESTION_ORDER = [
    "age",
    "gender",
    "state",
    "district",
    "social_category",
    "occupation",
    "annual_income",
    "family_members",
    "bank_account",
    "bpl_status"
]


# One session per Exotel stream
SESSIONS = {}


def start_session(session_id, language="hi"):
    """
    Start a new questionnaire session.
    Returns the first question.
    """

    SESSIONS[session_id] = {
        "language": language,
        "question_index": 0,
        "answers": {}
    }

    return generate_question(
        QUESTION_ORDER[0],
        language
    )


def submit_answer(session_id, answer_text):
    """
    Store the raw answer and move to the next question.
    """

    session = SESSIONS.get(session_id)

    if session is None:
        return None, True

    index = session["question_index"]

    field = QUESTION_ORDER[index]

    # Store raw answer for now
    session["answers"][field] = answer_text

    # Move to next question
    session["question_index"] += 1

    # All questions completed
    if session["question_index"] >= len(QUESTION_ORDER):
        return None, True

    next_field = QUESTION_ORDER[
        session["question_index"]
    ]

    language = session["language"]

    next_question = generate_question(
        next_field,
        language
    )

    return next_question, False


def get_session(session_id):
    return SESSIONS.get(session_id)


def clear_session(session_id):
    SESSIONS.pop(session_id, None)