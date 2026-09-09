import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_PARCELS } from "@/lib/fixtures";
import * as imagery from "@/lib/latest-imagery";
import { HistoricalImageryTimeline } from "./HistoricalImageryTimeline";

const windows = [
 {id:"2026-01",label:"Jan",startDate:"2026-01-30",endDate:"2026-01-31"},
 {id:"2026-02",label:"Feb",startDate:"2026-02-27",endDate:"2026-02-28"},
 {id:"latest",label:"Latest",startDate:"2026-03-01",endDate:"2026-03-03"},
];
function setup(dateWindows = windows) {
 vi.spyOn(imagery,"monthlyScenes").mockReturnValue(dateWindows);
 vi.spyOn(imagery,"sampleImageBlankness").mockReturnValue(false);
 return render(<HistoricalImageryTimeline parcel={FIXTURE_PARCELS[0]} />);
}
afterEach(()=>vi.restoreAllMocks());
describe("Worldview date browsing",()=>{
 it("chooses and swaps independent dates, naming both on the slider",()=>{
  setup(); fireEvent.click(screen.getByRole("button",{name:"Compare months"}));
  fireEvent.change(screen.getByRole("combobox",{name:"A imagery window"}),{target:{value:"2026-02"}});
  expect(screen.getByRole("combobox",{name:"B imagery window"})).toHaveValue("latest");
  expect(screen.getByRole("slider",{name:/Feb.*Latest/})).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Swap A and B"}));
  expect(screen.getByRole("combobox",{name:"A imagery window"})).toHaveValue("latest");
  expect(screen.getByRole("combobox",{name:"B imagery window"})).toHaveValue("2026-02");
 });
 it("never calls an unverifiable browse date an observation or clear pass",async()=>{
  setup(); vi.mocked(imagery.sampleImageBlankness).mockReturnValue(null);
  fireEvent.load(screen.getByRole("img",{name:/true-color snapshot/}));
  await waitFor(()=>expect(screen.getAllByText(/Preview quality unverified/).length).toBeGreaterThan(0));
  expect(screen.getByText(/Exact acquisition time unverified/)).toBeInTheDocument();
  expect(screen.queryByText(/2026-03-03 observation|most recent clear pass/)).not.toBeInTheDocument();
 });
 it("resets requested date and quality when parcel geometry changes",async()=>{
  const view=setup(); fireEvent.load(screen.getByRole("img",{name:/true-color snapshot/}));
  await waitFor(()=>expect(screen.getAllByText("Preview available").length).toBeGreaterThan(0));
  view.rerender(<HistoricalImageryTimeline parcel={{...FIXTURE_PARCELS[0],centroid:[70,20]}} />);
  expect(screen.queryByText("Preview available")).not.toBeInTheDocument();
  expect(decodeURIComponent(screen.getByRole("img",{name:/true-color snapshot/}).getAttribute("src")!)).toContain("69.920000");
 });
 it("keeps comparison-side failure explicit and retryable",async()=>{
  setup();fireEvent.click(screen.getByRole("button",{name:"Compare months"}));
  fireEvent.error(screen.getByRole("img",{name:/A.*Jan.*image/}));
  expect(screen.getByRole("button",{name:"Retry A imagery"})).toBeInTheDocument();
  expect(screen.getByRole("slider")).toBeDisabled();
  expect(screen.getByText(/does not establish source-image alignment/)).toBeInTheDocument();
 });
 it("bounds empty-preview search without claiming cloud or lack of coverage",async()=>{
  setup();vi.mocked(imagery.sampleImageBlankness).mockReturnValue(true);
  fireEvent.click(screen.getByRole("button",{name:"Jan"}));
  fireEvent.load(screen.getByRole("img",{name:/true-color snapshot/}));
  await waitFor(()=>expect(decodeURIComponent(screen.getByRole("img",{name:/true-color snapshot/}).getAttribute("src")!)).toContain("TIME=2026-01-30"));
  fireEvent.load(screen.getByRole("img",{name:/true-color snapshot/}));
  await waitFor(()=>expect(screen.getAllByText("No nonblank preview found").length).toBeGreaterThan(0));
  expect(screen.queryByText(/likely persistent cloud|No clear pass/)).not.toBeInTheDocument();
 });
 it("renders identical requested dates once and disables misleading comparison", () => {
  setup([
   windows[0], {...windows[2], startDate: windows[0].startDate, endDate: windows[0].endDate},
  ]);
  fireEvent.click(screen.getByRole("button", {name: "Compare months"}));
  expect(screen.getAllByRole("img", {name: /HLS Sentinel-2/})).toHaveLength(1);
  fireEvent.load(screen.getByRole("img", {name: /HLS Sentinel-2/}));
  expect(screen.getByRole("slider")).toBeDisabled();
  expect(screen.getByText(/Both windows currently request the same browse date/)).toBeInTheDocument();
 });
});
