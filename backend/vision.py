import os
from google import genai
from google.genai import types

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

SYSTEM_INSTRUCTION = (
    "Eres Clarity, un asistente de navegación y percepción para personas con discapacidad visual. "
    "Siempre hablas en español, de forma concisa y directa. "
    "Hablas directamente al usuario. "
    "Priorizas la seguridad ante todo: si hay peligro, lo mencionas primero."
)

# Disable all safety filters for hackathon — avoids false positives on real-world scenes
SAFETY_SETTINGS = [
    types.SafetySetting(category="HARM_CATEGORY_HARASSMENT",        threshold="BLOCK_NONE"),
    types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH",       threshold="BLOCK_NONE"),
    types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="BLOCK_NONE"),
    types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="BLOCK_NONE"),
]

MODE_PROMPTS = {
    "glasses": (
        "{known_people_ctx}"
        "Eres los ojos de una persona con discapacidad visual usando lentes inteligentes.\n"
        "Analiza esta imagen. Responde en español, máximo 2 oraciones muy cortas y directas.\n"
        "Prioridades: 1) Si hay peligro inmediato empieza con '¡CUIDADO!' "
        "2) Si hay texto visible (señales, letreros, mensajes) léelo "
        "3) Describe brevemente el entorno y las personas presentes.\n"
        "Habla directo: 'Estás en...', 'Hay...', 'Se ve...'"
    ),
    "read": (
        "Lee en voz alta TODO el texto visible en esta imagen:\n"
        "- Letreros y señales\n"
        "- Precios y números\n"
        "- Cualquier texto escrito\n\n"
        "Si no hay texto visible, dilo en una frase breve."
    ),
    "people": (
        "{known_people_ctx}"
        "Describe las personas visibles:\n"
        "- Cuántas hay y dónde (izquierda, derecha, frente, distancia)\n"
        "- Estado emocional o expresión facial\n"
        "- Qué están haciendo\n\n"
        "Sé respetuoso y objetivo. Máximo 3 oraciones."
    ),
    "full": (
        "Analiza esta imagen para ayudar a una persona con discapacidad visual.\n"
        "{known_people_ctx}"
        "{spatial_ctx}"
        "\nResponde en este orden (omite lo que no aplique):\n"
        "1. SEGURIDAD: ¿hay riesgos inmediatos?\n"
        "2. ENTORNO: ¿dónde estás y qué hay alrededor?\n"
        "3. PERSONAS: ¿quién está presente y cómo se ven?\n"
        "4. TEXTO: ¿hay texto importante visible?\n\n"
        "Máximo 4 oraciones en total. Sé conciso."
    ),
}


async def analyze_scene(
    image_bytes: bytes,
    media_type: str,
    mode: str,
    known_people: list[str],
    nearby_memories: list[dict],
) -> dict:
    people_ctx = ""
    if known_people:
        people_ctx = f"Personas reconocidas en la imagen: {', '.join(known_people)}.\n"

    spatial_ctx = ""
    if nearby_memories:
        places = "; ".join(m["description"] for m in nearby_memories[:3])
        spatial_ctx = f"Lugares conocidos cercanos: {places}.\n"

    class _Default(dict):
        def __missing__(self, _key):
            return ""

    prompt = MODE_PROMPTS.get(mode, MODE_PROMPTS["glasses"]).format_map(
        _Default(known_people_ctx=people_ctx, spatial_ctx=spatial_ctx)
    )

    # Build request: image first, then text prompt
    image_part  = types.Part.from_bytes(data=image_bytes, mime_type=media_type)
    prompt_part = types.Part.from_text(text=prompt)

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[image_part, prompt_part],
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                safety_settings=SAFETY_SETTINGS,
                max_output_tokens=350,
                temperature=0.4,
            ),
        )
        text = response.text.strip()
        print(f"[Gemini OK] mode={mode} chars={len(text)}")
        rate_limited = False

    except Exception as e:
        err_str = str(e)
        rate_limited = "429" in err_str or "RESOURCE_EXHAUSTED" in err_str

        # Print full error so it's visible in the backend terminal
        print(f"[Gemini ERROR] {type(e).__name__}: {err_str}")

        if rate_limited:
            text = "⚠ Cuota de API agotada — activa billing en aistudio.google.com"
        elif "400" in err_str:
            text = f"Error de formato en la petición: {err_str[:120]}"
        elif "403" in err_str:
            text = "API key inválida o sin permisos — revisa GEMINI_API_KEY en .env"
        else:
            text = f"Error Gemini ({type(e).__name__}): {err_str[:120]}"

    return {
        "text": text,
        "mode": mode,
        "known_people": known_people,
        "nearby_places": [m["description"] for m in nearby_memories[:3]],
        "rate_limited": rate_limited,
    }
