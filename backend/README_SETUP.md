# Setup Instructions

## Backend Setup

1. Install dependencies:
```bash
cd backend
pip install -r requirements.txt
```

2. Create `.env` file with your configuration (see `.env.example`)

3. Run the FastAPI server:
```bash
python main.py
```

4. Run the voice agent (in a separate terminal):
```bash
python run_agent.py
```

## Frontend Setup

1. Install dependencies:
```bash
cd frontend
npm install
```

2. Run the development server:
```bash
npm run dev
```

3. Open http://localhost:3000 in your browser

## Testing the Voice Agent

1. Start the FastAPI server
2. Start the voice agent
3. Start the frontend
4. Enter your name and click "Start Interview Session"
5. The agent will connect and start the interview

