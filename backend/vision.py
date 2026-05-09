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

MODE_PROMPTS = {
    "safety": (
        "Analiza esta imagen enfocándote SOLO en seguridad:\n"
        "- ¿Hay obstáculos en el camino?\n"
        "- Estado del semáforo si hay uno (rojo/verde/amarillo)\n"
        "- ¿Hay vehículos cerca?\n"
        "- ¿Es seguro avanzar?\n\n"
        "Máximo 2 oraciones. Si hay peligro empieza con '¡CUIDADO!'"
    ),
    "describe": (
        "Describe el entorno de esta imagen de forma natural:\n"
        "1. Tipo de lugar (interior/exterior)\n"
        "2. Objetos y espacios alrededor\n"
        "3. Algo notable que deba saber\n\n"
        "Máximo 3 oraciones. Habla directamente al usuario."
    ),
    "read": (
        "Lee en voz alta TODO el texto visible en esta imagen:\n"
        "- Letreros y señales\n"
        "- Precios y números\n"
        "- Cualquier texto escrito\n\n"
        "Si no hay texto visible, dilo en una frase breve."
    ),
    "people": (
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

    prompt = MODE_PROMPTS.get(mode, MODE_PROMPTS["full"]).format(
        known_people_ctx=people_ctx,
        spatial_ctx=spatial_ctx,
    )

    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type=media_type),
            types.Part.from_text(text=prompt),
        ],
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_INSTRUCTION,
            max_output_tokens=400,
            temperature=0.4,
        ),
    )

    text = response.text.strip()

    return {
        "text": text,
        "mode": mode,
        "known_people": known_people,
        "nearby_places": [m["description"] for m in nearby_memories[:3]],
    }
