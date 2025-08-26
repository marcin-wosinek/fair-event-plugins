# fair-timetable

## 1.0.2

### Patch Changes

- Renamed plugin from fair-schedule to fair-timetable
- Updated all internal references, CSS classes, and block names
- Changed namespace from FairSchedule to FairTimetable
- Renamed time-block to time-slot for better semantic clarity
- Removed header and columnTitle from timetable-column block for cleaner layout
- Added server-side render function for time-slot block with calculated hour offset parameter
- Added responsive design: time-range only shows when time-slot is wider than 320px
- Added timetable container block for organizing multiple timetable-columns horizontally
- Added context inheritance: timetable block provides time settings to all its columns
- Added smart UI: timetable-columns show read-only time settings when inside a timetable with 'Edit in Timetable' button

## 1.0.1

### Patch Changes

- Update dependencies to the newest version
