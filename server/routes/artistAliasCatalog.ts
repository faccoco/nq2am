import { Router, type Router as RouterType } from "express";
import {
  cancelArtistAliasCatalogDownload,
  readArtistAliasCatalogStatus,
  requestArtistAliasCatalogRefresh
} from "../../src/apple/artistAliasCatalog.js";

const router: RouterType = Router();

router.get("/artist-alias-catalog", async (_req, res) => {
  res.json(await readArtistAliasCatalogStatus());
});

router.post("/artist-alias-catalog/download", async (_req, res) => {
  const result = requestArtistAliasCatalogRefresh();
  const status = await readArtistAliasCatalogStatus();
  res.status(result === "already-running" || status.status === "downloading" ? 202 : 200).json(status);
});

router.post("/artist-alias-catalog/refresh", async (_req, res) => {
  const result = requestArtistAliasCatalogRefresh();
  const status = await readArtistAliasCatalogStatus();
  res.status(result === "already-running" || status.status === "downloading" ? 202 : 200).json(status);
});

router.post("/artist-alias-catalog/cancel", async (_req, res) => {
  cancelArtistAliasCatalogDownload();
  res.json(await readArtistAliasCatalogStatus());
});

export default router;
