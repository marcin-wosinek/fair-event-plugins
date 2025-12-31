# Events Calendar Block - Future Enhancements

## Overview

This document outlines planned features for the `fair-events/events-calendar` block beyond the current MVP implementation.

**Current MVP Features:**
- Single iCal feed URL input
- Custom color for iCal events
- On-demand parsing (no caching)
- Merges iCal events with local WordPress events

## High Priority Features

### 1. Multiple Data Sources with Repeater UI

**Current State:** Single iCal feed URL field

**Proposed Enhancement:**
- Repeater field allowing multiple data sources
- Each source has:
  - **Type**: iCal feed, Category filter, Author filter, or Custom query
  - **Configuration**: URL (for iCal), category IDs (for category), author IDs (for author)
  - **Color**: Custom background color for events from this source
  - **Label**: Optional display name (e.g., "Meetup Events", "Team Events")

**Implementation Approach:**
1. Update `block.json` attributes:
   ```json
   "dataSources": {
       "type": "array",
       "default": [],
       "items": {
           "type": "object",
           "properties": {
               "type": { "type": "string" },
               "config": { "type": "object" },
               "color": { "type": "string" },
               "label": { "type": "string" }
           }
       }
   }
   ```
2. Migrate existing `icalFeedUrl` and `icalFeedColor` to first data source on block save
3. Build repeater UI in `EditComponent.js` using `@wordpress/components` Repeater pattern
4. Update `render.php` to loop through data sources and merge all events

**Complexity**: Medium (UI complexity, data migration)

### 2. WordPress Transient Caching

**Current State:** iCal feeds fetched on every page render (performance issue)

**Proposed Enhancement:**
- Cache iCal feed data using WordPress transients
- Configurable cache duration (default: 24 hours)
- Per-feed cache keys (based on URL hash)
- Cache invalidation options in block settings

**Implementation Approach:**
1. Modify `ICalParser::fetch_and_parse()`:
   ```php
   public static function fetch_and_parse( $url, $cache_duration = DAY_IN_SECONDS ) {
       $cache_key = 'fair_events_ical_' . md5( $url );
       $cached = get_transient( $cache_key );

       if ( false !== $cached ) {
           return $cached;
       }

       // Existing fetch and parse logic...
       $events = // ... parsed events

       set_transient( $cache_key, $events, $cache_duration );
       return $events;
   }
   ```
2. Add cache duration attribute to block.json (default: 86400 seconds / 24 hours)
3. Add "Clear Cache" button in block settings (calls `delete_transient()`)
4. Optional: WP-CLI command to clear all iCal caches

**Complexity**: Low (WordPress transients are straightforward)

### 3. Recurring Event Support (RRULE Parsing)

**Current State:** Only displays individual event instances from iCal feed

**Proposed Enhancement:**
- Parse RRULE (recurrence rules) from iCal VEVENT
- Generate event instances within current month
- Support common RRULE patterns (DAILY, WEEKLY, MONTHLY, YEARLY with COUNT/UNTIL)

**Implementation Approach:**
1. Use sabre/vobject's built-in RRULE support:
   ```php
   // In ICalParser::parse_vevent()
   if ( isset( $vevent->RRULE ) ) {
       $rrule = $vevent->RRULE;
       $instances = $vevent->expand( $month_start, $month_end );

       foreach ( $instances as $instance ) {
           // Generate event data for each instance
       }
   }
   ```
2. Add configuration option: "Expand recurring events" (toggle)
3. Handle edge cases: EXDATE (exception dates), RDATE (additional dates)

**Complexity**: Medium (RRULE parsing is complex, but sabre/vobject handles it)

## Medium Priority Features

### 4. Filter by Author for Local Events

**Proposed Enhancement:**
- Add "Author" filter option for WordPress event sources
- Multi-select author dropdown (similar to category filter)
- Applies to local events only (not iCal)

**Implementation Approach:**
1. Add `authors` attribute to block.json (array of user IDs)
2. Add author selector in `EditComponent.js` using `UserSelect` component
3. Update WP_Query in `render.php`:
   ```php
   if ( ! empty( $authors ) ) {
       $query_args['author__in'] = $authors;
   }
   ```

**Complexity**: Low (similar to existing category filter)

### 5. Per-Source Category Filtering

**Current State:** Global category filter applies to all WordPress events

**Proposed Enhancement:**
- Move category filter into data source configuration
- Each WordPress event source can have different category filters
- Allows mixing events from different categories with different colors

**Implementation Approach:**
1. Add `categories` property to each data source in `dataSources` array
2. Deprecate global `categories` attribute (migrate on block save)
3. Update query logic to use per-source categories

**Complexity**: Low (data structure change, migration needed)

### 6. iCal Event Details Modal

**Current State:** iCal events show only title, description in tooltip

**Proposed Enhancement:**
- Clickable iCal events open modal with full details:
  - Event title
  - Start/end date and time
  - Location (if available in iCal)
  - Full description
  - Link to original event (if URL in iCal)

**Implementation Approach:**
1. Add `onClick` handler to `.ical-event-title` in frontend JavaScript
2. Extract additional iCal fields: LOCATION, URL, ORGANIZER
3. Build modal using vanilla JS or @wordpress/components Modal (if available frontend)
4. Store additional fields in event data array

**Complexity**: Medium (requires frontend JavaScript, modal UI)

## Low Priority Features

### 7. Custom Text Color for iCal Events

**Current State:** iCal events always use white text (#ffffff)

**Proposed Enhancement:**
- Add text color picker for iCal events (in addition to background color)
- Auto-contrast detection (suggest white/black based on background luminosity)

**Implementation Approach:**
1. Add `icalFeedTextColor` attribute to block.json
2. Add color picker in `EditComponent.js` iCal panel
3. Update CSS custom property in render.php: `--event-text-color: <?php echo esc_attr( $ical_feed_text_color ); ?>`

**Complexity**: Low (straightforward color picker addition)

### 8. Admin Notices for Feed Errors

**Current State:** iCal errors logged silently to PHP error log

**Proposed Enhancement:**
- Show admin notice when iCal feed fails to load (visible in WordPress admin)
- Notices visible only to users with `edit_posts` capability
- Option to dismiss notices

**Implementation Approach:**
1. Store failed feed URLs in transient: `fair_events_ical_errors`
2. Add admin notice hook:
   ```php
   add_action( 'admin_notices', function() {
       $errors = get_transient( 'fair_events_ical_errors' );
       if ( $errors && current_user_can( 'edit_posts' ) ) {
           echo '<div class="notice notice-warning is-dismissible">';
           echo '<p>iCal feed error: ' . esc_html( $errors ) . '</p>';
           echo '</div>';
       }
   } );
   ```
3. Clear transient when feed loads successfully

**Complexity**: Low (WordPress admin notices are simple)

### 9. Timezone Support

**Current State:** All dates assumed in WordPress site timezone

**Proposed Enhancement:**
- Parse VTIMEZONE from iCal feeds
- Display event times in site timezone (convert from event timezone)
- Show original timezone in event details

**Implementation Approach:**
1. Extract VTIMEZONE from iCal:
   ```php
   if ( isset( $vcalendar->VTIMEZONE ) ) {
       $timezone = $vcalendar->VTIMEZONE->TZID;
       // Convert to site timezone
   }
   ```
2. Use PHP DateTime with timezone conversion
3. Add "(EST)", "(PST)" etc. indicators to event times

**Complexity**: High (timezone handling is complex and error-prone)

## Testing Recommendations

When implementing these features, ensure thorough testing:

1. **Multiple Feed Sources**: Test with 3+ iCal feeds simultaneously
2. **Cache Invalidation**: Verify transient cache clears properly
3. **Recurring Events**: Test RRULE with complex patterns (WEEKLY with BYDAY, etc.)
4. **Error Handling**: Test with invalid URLs, malformed iCal, network timeouts
5. **Performance**: Benchmark page load time with 5+ data sources and 100+ events
6. **Responsive Design**: Verify modal displays correctly on mobile devices
7. **Timezone Edge Cases**: Test events crossing DST boundaries

## Migration Strategy

When adding multiple data sources (Priority 1):

1. **Detect legacy attributes**: Check if `icalFeedUrl` exists and `dataSources` is empty
2. **Auto-migrate**: Create first data source from legacy attributes
3. **Preserve data**: Keep legacy attributes for rollback compatibility
4. **User notification**: Show notice in block editor: "Your iCal settings have been migrated to the new data sources format"

Example migration code:
```javascript
// In EditComponent.js useEffect
useEffect(() => {
    if (icalFeedUrl && dataSources.length === 0) {
        const migratedSource = {
            type: 'ical',
            config: { url: icalFeedUrl },
            color: icalFeedColor || '#4caf50',
            label: 'iCal Feed'
        };
        setAttributes({ dataSources: [migratedSource] });
    }
}, [icalFeedUrl, dataSources, icalFeedColor, setAttributes]);
```

## Implementation Priority Order

Recommended implementation sequence:

1. **WordPress transient caching** (quick win, major performance improvement)
2. **Multiple data sources UI** (foundation for other features)
3. **Filter by author** (completes data source types)
4. **Recurring event support** (high user value)
5. **Per-source category filtering** (cleanup from multiple sources)
6. **iCal event details modal** (improves UX)
7. **Custom text color** (nice to have)
8. **Admin notices** (debugging tool)
9. **Timezone support** (complex, low priority)

## Notes

- All new features should maintain backward compatibility with MVP implementation
- Consider adding unit tests for ICalParser class (PHPUnit)
- Document breaking changes in changelog
- Update block README with new feature documentation

---

**Last Updated**: 2025-12-31
**Current Version**: MVP (single iCal feed, no caching)
**Next Milestone**: Multiple data sources + caching (v1.1.0)
