import { Router, type Router as RouterType } from "express";
import { getPreferences, PreferencesValidationError, setPreferences } from "../preferences.js";

const router: RouterType = Router();

router.get("/preferences", async (_req, res) => {
  res.json(await getPreferences());
});

router.put("/preferences", async (req, res) => {
  try {
    const next = await setPreferences(req.body);
    res.json(next);
  } catch (error) {
    if (error instanceof PreferencesValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }
});

export default router;
