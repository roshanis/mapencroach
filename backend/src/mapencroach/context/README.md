# SHRUG context import boundary

`shrug.py` accepts already-parsed, caller-supplied rows and turns them into
context-only parcel records. It does not download SHRUG files, execute external
code, or treat an aggregate geographic match as parcel evidence.

## Before importing official data

Development Data Lab's current publications use two different license
descriptions:

- The [SHRUG documentation license page](https://docs.devdatalab.org/Getting-Started/license/)
  describes terms based on the Open Data Commons ODbL.
- The [Development Data Lab SHRUG page](https://www.devdatalab.org/shrug)
  describes the data as CC BY-NC-SA 4.0 for non-commercial use and directs
  commercial users to contact DDL.

Because those statements have different implications, do not bundle or
redistribute official SHRUG data until the intended use and the applicable
module terms have been reviewed. `redistribution_reviewed=True` records that a
human completed that review; it is not an automated license determination.
Each manifest must also retain the module, version, vintage, source URL,
resolution, limitations, and license note. Module-specific citations should be
recorded too; DDL's [citation guidance](https://docs.devdatalab.org/Getting-Started/citation/)
states that the original data producers should be cited.

## Required row contract

- A geographic link row must include `shrid2`.
- Observation rows are filtered to the parcel's linked `shrid2`; rows for other
  units are ignored.
- The caller names the indicator field, period field, display label, and unit.
- Every resulting link and observation is permanently marked `context_only`.
- A source manifest is returned with the observations so provenance cannot be
  dropped accidentally.

Demo manifests are intentionally different: their provider is `mapencroach
demo`, their limitations say that values are illustrative, and their license
note states that no SHRUG data is redistributed.
