import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import * as admin from 'firebase-admin';

// Initialize Firebase Admin lazily
let dbAdmin: admin.firestore.Firestore | null = null;
function getDbAdmin() {
  if (!dbAdmin) {
    if (!admin.apps.length) {
      try {
        admin.initializeApp({
          credential: admin.credential.applicationDefault()
        });
      } catch (e) {
        console.warn("Failed to initialize Firebase Admin with applicationDefault, falling back to unauthenticated/default initialized app", e);
        admin.initializeApp();
      }
    }
    dbAdmin = admin.firestore();
  }
  return dbAdmin;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Helper to verify ID token
  const verifyAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    try {
      getDbAdmin(); // Ensures initializeApp has been called
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      (req as any).user = decodedToken;
      next();
    } catch (error) {
      res.status(401).json({ error: 'Unauthorized' });
    }
  };

  // API routes
  app.post("/api/tasks", verifyAuth, async (req, res) => {
    const { title, description, clientTaskId } = req.body;
    const userId = (req as any).user.uid;
    const now = admin.firestore.FieldValue.serverTimestamp();

    try {
      const db = getDbAdmin();
      const tasksRef = db.collection('tasks');
      
      // Idempotency check if clientTaskId is provided
      if (clientTaskId) {
        const querySnapshot = await tasksRef.where('userId', '==', userId).where('clientTaskId', '==', clientTaskId).get();
        if (!querySnapshot.empty) {
          return res.json({ id: querySnapshot.docs[0].id, ...querySnapshot.docs[0].data() });
        }
      }

      const newTask = {
        title,
        description: description || "",
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        userId,
        clientTaskId: clientTaskId || null
      };

      const docRef = await tasksRef.add(newTask);
      res.status(201).json({ id: docRef.id, ...newTask });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to create task" });
    }
  });

  app.get("/api/tasks", verifyAuth, async (req, res) => {
    const userId = (req as any).user.uid;
    try {
      const db = getDbAdmin();
      const snapshot = await db.collection('tasks').where('userId', '==', userId).get();
      const tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(tasks);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch tasks" });
    }
  });

  // Proxy for ESPN Sports News Api (Multiple Leagues)
  app.get("/api/news", async (req, res) => {
    try {
      const leagues = ['eng.1', 'esp.1', 'uefa.champions'];
      let allArticles: any[] = [];
      
      await Promise.all(leagues.map(async (league) => {
        for (let page = 1; page <= 3; page++) {
          try {
            const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/news?limit=50&page=${page}`);
            if (response.ok) {
              const data = await response.json();
              if (data.articles && data.articles.length > 0) {
                allArticles.push(...data.articles);
              }
            }
          } catch (e) {
             // ignore error for single league
          }
        }
      }));
      
      // Deduplicate by id if needed, though they shouldn't overlap much
      const uniqueArticles = Array.from(new Map(allArticles.map(a => [a.dataSourceIdentifier || a.headline, a])).values());
      // Sort by published descending
      uniqueArticles.sort((a: any, b: any) => new Date(b.published).getTime() - new Date(a.published).getTime());
      
      res.json(uniqueArticles);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch news" });
    }
  });

  // Proxy for ESPN Sports Scores Api (Multiple Leagues)
  app.get("/api/scores", async (req, res) => {
    try {
      const today = new Date();
      const past = new Date(today);
      past.setDate(today.getDate() - 14); // get up to two weeks past
      const future = new Date(today);
      future.setDate(today.getDate() + 7); // get upcoming week

      const fd = (d: Date) => d.toISOString().split('T')[0].replace(/-/g, '');
      const dates = `${fd(past)}-${fd(future)}`;

      const leagues = ['eng.1', 'eng.2', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'uefa.champions', 'uefa.europa', 'uefa.europa.conf'];
      let allEvents: any[] = [];

      await Promise.all(leagues.map(async (league) => {
        try {
          const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${dates}`);
          if (response.ok) {
            const data = await response.json();
            if (data.events) {
              const eventsWithLeague = data.events.map((e: any) => ({ ...e, _league: league }));
              allEvents.push(...eventsWithLeague);
            }
          }
        } catch (e) {
           // ignore
        }
      }));

      res.json(allEvents);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch scores" });
    }
  });

  // Proxy for ESPN Match Summary Api
  app.get("/api/summary", async (req, res) => {
    try {
      const { league, event } = req.query;
      if (!league || !event) {
        return res.status(400).json({ error: "Missing league or event parameter" });
      }
      const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/summary?event=${event}`);
      if (!response.ok) {
        return res.status(response.status).json({ error: "Failed to fetch from ESPN" });
      }
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch summary" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
