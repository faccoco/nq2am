import { Router, type Router as RouterType } from "express";
import { createAppleMusicPlaylistFromReport } from "../../src/apple/matcher.js";
import { getPreferences } from "../preferences.js";
import { getMatchReport, getPlaylist, setApplePlaylistId, setMatchReport, setTaskStatus } from "../state.js";

const router: RouterType = Router();

router.post("/create-playlist", async (req, res) => {
  const { playlistId, name, description } = req.body as {
    playlistId?: string;
    name?: string;
    description?: string;
  };
  if (!playlistId) {
    res.status(400).json({ error: "playlistId is required" });
    return;
  }

  const playlist = await getPlaylist(playlistId);
  const report = getMatchReport(playlistId);
  if (!report) {
    res.status(404).json({ error: "Match report not found. Run match first." });
    return;
  }

  const matchedCount = report.results.filter((result) => result.status === "matched").length;
  if (matchedCount === 0) {
    res.status(400).json({ error: "No matched tracks to add to playlist" });
    return;
  }

  const playlistName = name ?? playlist?.name ?? "Imported Playlist";
  const playlistDescription = description ?? `Imported from ${playlist?.provider ?? "nq2am"} - ${matchedCount} tracks`;

  setTaskStatus(playlistId, "creating");
  try {
    const prefs = await getPreferences();
    const newPlaylistId = await createAppleMusicPlaylistFromReport(report, prefs, playlistName, playlistDescription);
    setMatchReport(playlistId, report);
    setApplePlaylistId(playlistId, newPlaylistId);
    res.json({ playlistId: newPlaylistId });
  } catch (error) {
    setTaskStatus(playlistId, "create_failed", (error as Error).message);
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
