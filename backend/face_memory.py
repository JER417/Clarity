import io
import os

import numpy as np
from PIL import Image

try:
    import face_recognition
    FACE_RECOGNITION_AVAILABLE = True
except ImportError:
    FACE_RECOGNITION_AVAILABLE = False

try:
    import firebase_admin
    from firebase_admin import credentials, firestore as fb_firestore
    FIREBASE_AVAILABLE = True
except ImportError:
    FIREBASE_AVAILABLE = False


def _init_firebase():
    if not FIREBASE_AVAILABLE:
        return None
    if firebase_admin._apps:
        return fb_firestore.client()
    cred_path = os.getenv("FIREBASE_CREDENTIALS_PATH", "firebase-credentials.json")
    if not os.path.exists(cred_path):
        return None
    cred = credentials.Certificate(cred_path)
    firebase_admin.initialize_app(cred, {
        "storageBucket": os.getenv("FIREBASE_STORAGE_BUCKET", ""),
    })
    return fb_firestore.client()


class FaceMemory:
    def __init__(self):
        self.db = _init_firebase()
        self._collection = "faces"
        self._cache: dict[str, np.ndarray] = {}
        if self.db:
            self._load_cache()

    def _load_cache(self):
        docs = self.db.collection(self._collection).stream()
        for doc in docs:
            data = doc.to_dict()
            if "encoding" in data:
                self._cache[data["name"]] = np.array(data["encoding"])

    def remember(self, image_bytes: bytes, name: str) -> dict:
        if not FACE_RECOGNITION_AVAILABLE:
            return {"success": False, "error": "face_recognition no disponible"}

        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        img_array = np.array(img)
        encodings = face_recognition.face_encodings(img_array)
        if not encodings:
            return {"success": False, "error": "No se detectó ningún rostro en la imagen"}

        enc = encodings[0]
        self._cache[name] = enc

        if self.db:
            self.db.collection(self._collection).document(name).set({
                "name": name,
                "encoding": enc.tolist(),
            })

        return {"success": True, "name": name}

    def identify(self, image_bytes: bytes) -> list[str]:
        if not FACE_RECOGNITION_AVAILABLE or not self._cache:
            return []

        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        img_array = np.array(img)
        unknown_encodings = face_recognition.face_encodings(img_array)
        if not unknown_encodings:
            return []

        known_names = list(self._cache.keys())
        known_encodings = list(self._cache.values())
        identified = []

        for unknown_enc in unknown_encodings:
            distances = face_recognition.face_distance(known_encodings, unknown_enc)
            best_idx = int(np.argmin(distances))
            if distances[best_idx] < 0.55:
                identified.append(known_names[best_idx])

        return list(set(identified))

    def list_people(self) -> list[str]:
        return sorted(self._cache.keys())

    def forget(self, name: str) -> bool:
        existed = name in self._cache
        self._cache.pop(name, None)
        if self.db and existed:
            self.db.collection(self._collection).document(name).delete()
        return existed

    @property
    def available(self) -> bool:
        return FACE_RECOGNITION_AVAILABLE
