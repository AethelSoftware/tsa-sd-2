from flask import Flask, jsonify
from flask_cors import CORS
from flask_pymongo import PyMongo

app = Flask(__name__)
app.config["MONGO_URI"] = "mongodb+srv://jshah26:tsasd2026@tsa-sd-2026.h9qb1rd.mongodb.net/TRYVER"

mongo = PyMongo(app)

CORS(app, resources={r"/api/*": {"origins": "*"}})  # allow all origins for /api/*

@app.route("/api/hello")
def hello():
    return jsonify({"message": "Hello from Flask!"})

if __name__ == "__main__":
    app.run(debug=True)
