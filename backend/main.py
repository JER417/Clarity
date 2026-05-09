import base64
import os
import sys

from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from face_memory import FaceMemory
from spatial_memory import SpatialMemory
from tts import pcm_to_wav, text_to_speech
from vision import analyze_scene

app = FastAPI(title="Clarity API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

face_db = FaceMemory()
spatial_db = SpatialMemory()


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "face_recognition": face_db.available,
        "known_people": face_db.list_people(),
    }


@app.post("/analyze")
async def analyze(
    image: UploadFile = File(...),
    mode: str = Form("full"),
    lat: float = Form(None),
    lng: float = Form(None),
    tts: bool = Form(True),
):
    img_bytes = await image.read()

    media_type = image.content_type or "image/jpeg"
    if media_type not in ("image/jpeg", "image/png", "image/gif", "image/webp"):
        media_type = "image/jpeg"

    known_people = face_db.identify(img_bytes)

    nearby: list[dict] = []
    if lat is not None and lng is not None:
        nearby = spatial_db.get_nearby(lat, lng)

    result = await analyze_scene(img_bytes, media_type, mode, known_people, nearby)

    if tts and result.get("text"):
        pcm_bytes = await text_to_speech(result["text"])
        if pcm_bytes:
            wav_bytes = pcm_to_wav(pcm_bytes)
            result["audio_b64"] = base64.b64encode(wav_bytes).decode()

    return JSONResponse(result)


@app.post("/remember-person")
async def remember_person(
    image: UploadFile = File(...),
    name: str = Form(...),
):
    img_bytes = await image.read()
    result = face_db.remember(img_bytes, name)
    return JSONResponse(result)


@app.post("/remember-place")
async def remember_place(
    description: str = Form(...),
    lat: float = Form(...),
    lng: float = Form(...),
):
    result = spatial_db.remember(lat, lng, description)
    return JSONResponse({**result, "description": description})


@app.get("/people")
async def list_people():
    return {"people": face_db.list_people()}


@app.delete("/people/{name}")
async def forget_person(name: str):
    success = face_db.forget(name)
    return {"success": success, "name": name}


@app.get("/places")
async def list_places():
    return {"places": spatial_db.list_all()}


frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.exists(frontend_path):
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
