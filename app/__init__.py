from flask import Flask
from .routes import main_bp

def create_app():
    app = Flask(__name__)

    # Register the blueprint from routes.py
    app.register_blueprint(main_bp)

    return app
