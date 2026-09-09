import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ImagerySourceDetails } from "./ImagerySourceDetails";
import type { CaptureAttempt } from "@/lib/types";
const attempt: CaptureAttempt = {
 week:"2026-W32",status:"captured",attempted_at:"2026-08-09T12:00:00Z",scene_id:"scene-1",
 sha256:"f".repeat(64),cloud_pct:0,reason:null,image_url:null,
 scene_details:{metadata_status:"available",scene_id:"scene-1",captured_at:"2026-08-03T05:15:00Z",
 sensor:"Sentinel-1 SAR",resolution_m:10,cloud_pct:0,source:"Synthetic demo",retained:false,synthetic:true},
};
describe("scene source details",()=>{
 it("distinguishes observation time, attempt time, radar quality and retention",()=>{
  render(<ImagerySourceDetails observation={{kind:"registered",attempt}} />);
  expect(screen.getByText("2026-08-03 05:15:00 UTC")).toBeInTheDocument();
  expect(screen.getByText("2026-08-09 12:00:00 UTC")).toBeInTheDocument();
  expect(screen.getByText(/Not applicable to SAR/)).toBeInTheDocument();
  expect(screen.getByText("Bytes were not retained")).toBeInTheDocument();
  expect(screen.getByText("Synthetic demonstration metadata")).toBeInTheDocument();
 });
 it("does not manufacture missing metadata from an attempt date",()=>{
  render(<ImagerySourceDetails observation={{kind:"registered",attempt:{...attempt,scene_details:undefined}}} />);
  expect(screen.getByText(/observation time, source, and retention are not verified/)).toBeInTheDocument();
  expect(screen.queryByText("Observation time (provider reported)")).not.toBeInTheDocument();
 });
});
