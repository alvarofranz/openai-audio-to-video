# openai-audio-to-video

A Python tool to:
1. Transcribe audio with **OpenAI Whisper**.
2. Generate images with **DALL·E3**.
3. Create a 1080p MP4 video with cross-fades and fade-in/out.

## Requirements

- Python 3.7+
- [ffmpeg](https://ffmpeg.org/download.html) installed on your system
- The packages in `requirements.txt`
- `.env` file with your `OPENAI_API_KEY`

## Setup a Virtual Environment

1. **Create** a virtual environment (e.g., named `venv`):
   ```bash
   python -m venv venv
   ```
2. **Activate** the virtual environment:
   ```bash
   On Windows:venv\Scripts\activate
   On macOS/Linux: source venv/bin/activate
   ```
3. **Install** the required packages:
   ```bash
   pip install -r requirements.txt
   ```
4. **Create** a `.env` file in the root directory and add your OpenAI API key:
   ```bash
   OPENAI_API_KEY=your_openai_api_key
   ```
5. **Run** the script:
   ```bash
   python create_video.py ./demo/audio-file.mp3
   ```
   
--------------

Enjoy!
