<?php
/**
 * Events Calendar Block - Server-side rendering
 *
 * @package FairEvents
 *
 * @var array    $attributes Block attributes.
 * @var string   $content    Block default content.
 * @var WP_Block $block      Block instance.
 */

defined( 'WPINC' ) || die;

use FairEvents\Helpers\EventSchema;
use FairEvents\Services\EventFeedProvider;
use FairEvents\Settings\Settings;

/**
 * Convert color value to CSS value
 *
 * Converts either a hex color or a WordPress color preset name to a CSS value.
 *
 * @param string $color Color value (hex like '#4caf50' or preset name like 'primary').
 * @return string CSS color value.
 */
if ( ! function_exists( 'fair_events_convert_color_to_css' ) ) {
	function fair_events_convert_color_to_css( $color ) {
		if ( preg_match( '/^#[0-9A-Fa-f]{3,6}$/', $color ) ) {
			return $color;
		}
		return 'var(--wp--preset--color--' . esc_attr( $color ) . ')';
	}
}

/**
 * Render calendar event item HTML
 *
 * Handles rendering for all occurrence sources: post-linked, standalone, and
 * external (iCal/API) events.
 *
 * @param array  $occurrence       Occurrence DTO from EventFeedProvider.
 * @param string $bg_color_value   Background color CSS value (post-linked/standalone events).
 * @param string $text_color_value Text color CSS value (post-linked/standalone events).
 * @return void Outputs HTML directly.
 */
if ( ! function_exists( 'fair_events_render_calendar_event_item' ) ) {
	function fair_events_render_calendar_event_item( $occurrence, $bg_color_value, $text_color_value ) {
		$is_external_source = in_array( $occurrence['source'], array( 'ical', 'api' ), true );

		if ( $is_external_source ) {
			$event_title = $occurrence['title'];
			$event_url   = $occurrence['url'];
			$event_desc  = $occurrence['description'];
			$color_value = fair_events_convert_color_to_css( $occurrence['source_color'] ?: '#4caf50' );
			?>
			<div class="event-item is-ical"
				data-event-id="<?php echo esc_attr( $occurrence['uid'] ); ?>"
				style="--event-bg-color: <?php echo esc_attr( $color_value ); ?>; --event-text-color: #fff">
				<?php if ( ! empty( $event_url ) ) : ?>
					<a href="<?php echo esc_url( $event_url ); ?>"
						class="ical-event-title"
						title="<?php echo esc_attr( $event_desc ); ?>"
						target="_blank"
						rel="noopener noreferrer">
						<?php echo esc_html( $event_title ); ?>
					</a>
				<?php else : ?>
					<span class="ical-event-title" title="<?php echo esc_attr( $event_desc ); ?>">
						<?php echo esc_html( $event_title ); ?>
					</span>
				<?php endif; ?>
			</div>
			<?php
			return;
		}

		$event_title = $occurrence['title'];
		$event_url   = $occurrence['url'];

		$item_classes = array( 'event-item' );
		if ( 'standalone' === $occurrence['source'] ) {
			$item_classes[] = 'is-standalone';
		}
		if ( ! empty( $occurrence['is_draft'] ) ) {
			$item_classes[] = 'is-draft';
		}
		if ( 'generated' === $occurrence['occurrence_type'] ) {
			$item_classes[] = 'is-instance';
		}
		?>
		<div class="<?php echo esc_attr( implode( ' ', $item_classes ) ); ?>"
			data-event-id="<?php echo esc_attr( $occurrence['uid'] ); ?>"
			style="--event-bg-color: <?php echo esc_attr( $bg_color_value ); ?>; --event-text-color: <?php echo esc_attr( $text_color_value ); ?>">
			<?php if ( ! empty( $event_url ) ) : ?>
				<a href="<?php echo esc_url( $event_url ); ?>" class="event-title">
					<?php echo esc_html( $event_title ); ?>
				</a>
			<?php else : ?>
				<span class="event-title"><?php echo esc_html( $event_title ); ?></span>
			<?php endif; ?>
		</div>
		<?php
	}
}

/*
 * Calendar Rendering Logic
 *
 * This block uses a hybrid server-side rendering approach:
 * 1. Reads month/year from URL parameters (for navigation) or block attributes
 * 2. Validates and sanitizes date inputs
 * 3. Fetches occurrences for the month via EventFeedProvider (local + external streams)
 * 4. Groups occurrences by date via EventFeedProvider::group_by_day() (handling multi-day events)
 * 5. Calculates calendar grid structure (leading/trailing blank cells)
 * 6. Renders events
 * 7. Highlights current day, marks past days
 * 8. Responsive: Desktop shows full grid, mobile shows only event days
 */

// Get block attributes
$start_of_week   = Settings::get_start_of_week();
$show_navigation = $attributes['showNavigation'] ?? true;
$categories      = $attributes['categories'] ?? array();
$show_drafts     = $attributes['showDrafts'] ?? false;
$bg_color        = $attributes['backgroundColor'] ?? 'primary';
$text_color      = $attributes['textColor'] ?? '#ffffff';
$event_sources   = $attributes['eventSources'] ?? array();

// Convert WordPress event colors to CSS values (used for post-linked/standalone events)
$bg_color_value   = fair_events_convert_color_to_css( $bg_color );
$text_color_value = fair_events_convert_color_to_css( $text_color );

// Get month/year from URL parameters or block attributes
// URL params take precedence (for navigation), then block attributes, then current date
$url_month     = isset( $_GET['calendar_month'] ) ? sanitize_text_field( $_GET['calendar_month'] ) : '';
$url_year      = isset( $_GET['calendar_year'] ) ? sanitize_text_field( $_GET['calendar_year'] ) : '';
$current_month = $url_month ?: ( $attributes['currentMonth'] ?: current_time( 'm' ) );
$current_year  = $url_year ?: ( $attributes['currentYear'] ?: current_time( 'Y' ) );

// Validate month (01-12)
if ( ! preg_match( '/^(0[1-9]|1[0-2])$/', $current_month ) ) {
	$current_month = current_time( 'm' );
}

// Validate year (1900-2100)
if ( ! preg_match( '/^\d{4}$/', $current_year ) || $current_year < 1900 || $current_year > 2100 ) {
	$current_year = current_time( 'Y' );
}

// Calculate grid structure early (needed for query range)
$first_day_of_month_ts = strtotime( "{$current_year}-{$current_month}-01" );
$days_in_month         = (int) gmdate( 't', $first_day_of_month_ts );
$first_weekday         = (int) gmdate( 'w', $first_day_of_month_ts ); // 0=Sunday, 6=Saturday

// Adjust so day 0 in the grid matches the configured start_of_week (0-6).
$first_weekday = ( $first_weekday - $start_of_week + 7 ) % 7;

$leading_blanks  = $first_weekday;
$total_cells     = $leading_blanks + $days_in_month;
$trailing_blanks = ( 0 === $total_cells % 7 ) ? 0 : 7 - ( $total_cells % 7 );

// Calculate extended query range including adjacent month days
$query_start          = gmdate( 'Y-m-d 00:00:00', strtotime( "-{$leading_blanks} days", $first_day_of_month_ts ) );
$last_day_of_month_ts = strtotime( "{$current_year}-{$current_month}-{$days_in_month}" );
$query_end            = gmdate( 'Y-m-d 23:59:59', strtotime( "+{$trailing_blanks} days", $last_day_of_month_ts ) );

// Fetch occurrences for the extended range and bucket them by day.
$provider = new EventFeedProvider();

$occurrences = $provider->get_occurrences(
	$query_start,
	$query_end,
	array(
		'categories'         => $categories,
		'event_source_slugs' => is_array( $event_sources ) ? $event_sources : array(),
		'include_drafts'     => $show_drafts,
	)
);

$events_by_date = EventFeedProvider::group_by_day( $occurrences, $query_start, $query_end );

$item_list = EventSchema::item_list_from_occurrences( $occurrences );

// Calculate previous/next month URLs
$prev_month_timestamp = strtotime( '-1 month', $first_day_of_month_ts );
$next_month_timestamp = strtotime( '+1 month', $first_day_of_month_ts );

$prev_url = add_query_arg(
	array(
		'calendar_month' => gmdate( 'm', $prev_month_timestamp ),
		'calendar_year'  => gmdate( 'Y', $prev_month_timestamp ),
	)
);

$next_url = add_query_arg(
	array(
		'calendar_month' => gmdate( 'm', $next_month_timestamp ),
		'calendar_year'  => gmdate( 'Y', $next_month_timestamp ),
	)
);

// Generate localized weekday labels using WordPress date formatting
// Start from the configured start_of_week (0 = Sunday, 1 = Monday)
$weekdays = array();
for ( $i = 0; $i < 7; $i++ ) {
	// Calculate day of week: 0 (Sun) through 6 (Sat)
	$day_of_week = ( $start_of_week + $i ) % 7;
	// Get a date that falls on this day of week (use a known week: 2024-01-07 is Sunday)
	$base_sunday   = strtotime( '2024-01-07' ); // Sunday
	$day_timestamp = $base_sunday + ( $day_of_week * DAY_IN_SECONDS );
	// Format using WordPress localized date function (D = abbreviated weekday name)
	$weekdays[] = wp_date( 'D', $day_timestamp );
}

// Get current date for today highlighting
$today = current_time( 'Y-m-d' );

?>
<div <?php echo wp_kses_post( get_block_wrapper_attributes( array( 'class' => 'wp-block-fair-events-events-calendar' ) ) ); ?>>
	<?php if ( $show_navigation ) : ?>
	<div class="fair-events-navigation">
		<a href="<?php echo esc_url( $prev_url ); ?>" class="nav-prev">
			<?php esc_html_e( 'Previous', 'fair-events' ); ?>
		</a>
		<h2 class="navigation-title">
			<?php echo esc_html( date_i18n( 'F Y', $first_day_of_month_ts ) ); ?>
		</h2>
		<a href="<?php echo esc_url( $next_url ); ?>" class="nav-next">
			<?php esc_html_e( 'Next', 'fair-events' ); ?>
		</a>
	</div>
	<?php endif; ?>

	<div class="calendar-grid" role="grid" aria-label="<?php echo esc_attr( date_i18n( 'F Y', $first_day_of_month_ts ) ); ?>">
		<!-- Weekday headers -->
		<div class="calendar-header" role="row">
			<?php foreach ( $weekdays as $weekday ) : ?>
			<div class="weekday-header" role="columnheader">
				<?php echo esc_html( $weekday ); ?>
			</div>
			<?php endforeach; ?>
		</div>

		<!-- Calendar body -->
		<div class="calendar-body">
			<?php
			// Leading days from previous month
			for ( $i = 0; $i < $leading_blanks; $i++ ) :
				$day_offset   = $leading_blanks - $i;
				$date_ts      = strtotime( "-{$day_offset} days", $first_day_of_month_ts );
				$current_date = gmdate( 'Y-m-d', $date_ts );
				$day_num      = gmdate( 'j', $date_ts );
				$day_events   = $events_by_date[ $current_date ] ?? array();
				$is_past      = strtotime( $current_date ) < strtotime( $today );

				$day_classes = array( 'calendar-day', 'other-month' );
				if ( $is_past ) {
					$day_classes[] = 'past';
				}
				if ( ! empty( $day_events ) ) {
					$day_classes[] = 'has-events';
				}

				$month_name = date_i18n( 'F', $date_ts );
				?>
			<div class="<?php echo esc_attr( implode( ' ', $day_classes ) ); ?>"
				role="gridcell"
				data-date="<?php echo esc_attr( $current_date ); ?>"
				data-month-name="<?php echo esc_attr( $month_name ); ?>">
				<div class="day-number"><?php echo esc_html( $day_num ); ?></div>

				<?php if ( ! empty( $day_events ) ) : ?>
				<div class="day-events">
					<?php foreach ( $day_events as $occurrence ) : ?>
						<?php fair_events_render_calendar_event_item( $occurrence, $bg_color_value, $text_color_value ); ?>
					<?php endforeach; ?>
				</div>
				<?php endif; ?>
			</div>
				<?php
			endfor;

			// Actual month days
			for ( $day = 1; $day <= $days_in_month; $day++ ) :
				$current_date = sprintf( '%s-%s-%02d', $current_year, $current_month, $day );
				$day_events   = $events_by_date[ $current_date ] ?? array();
				$is_today     = $current_date === $today;
				$is_past      = strtotime( $current_date ) < strtotime( $today );

				$day_classes = array( 'calendar-day' );
				if ( $is_today ) {
					$day_classes[] = 'today';
				}
				if ( $is_past ) {
					$day_classes[] = 'past';
				}
				if ( ! empty( $day_events ) ) {
					$day_classes[] = 'has-events';
				}

				$month_name = date_i18n( 'F', strtotime( $current_date ) );
				?>
			<div class="<?php echo esc_attr( implode( ' ', $day_classes ) ); ?>"
				role="gridcell"
				data-date="<?php echo esc_attr( $current_date ); ?>"
				data-month-name="<?php echo esc_attr( $month_name ); ?>">
				<div class="day-number"><?php echo esc_html( $day ); ?></div>

				<?php if ( ! empty( $day_events ) ) : ?>
				<div class="day-events">
					<?php foreach ( $day_events as $occurrence ) : ?>
						<?php fair_events_render_calendar_event_item( $occurrence, $bg_color_value, $text_color_value ); ?>
					<?php endforeach; ?>
				</div>
				<?php endif; ?>
			</div>
				<?php
			endfor;

			// Trailing days from next month
			for ( $i = 0; $i < $trailing_blanks; $i++ ) :
				$day_offset   = $i + 1;
				$date_ts      = strtotime( "+{$day_offset} days", $last_day_of_month_ts );
				$current_date = gmdate( 'Y-m-d', $date_ts );
				$day_num      = gmdate( 'j', $date_ts );
				$day_events   = $events_by_date[ $current_date ] ?? array();
				$is_past      = strtotime( $current_date ) < strtotime( $today );

				$day_classes = array( 'calendar-day', 'other-month' );
				if ( $is_past ) {
					$day_classes[] = 'past';
				}
				if ( ! empty( $day_events ) ) {
					$day_classes[] = 'has-events';
				}

				$month_name = date_i18n( 'F', $date_ts );
				?>
			<div class="<?php echo esc_attr( implode( ' ', $day_classes ) ); ?>"
				role="gridcell"
				data-date="<?php echo esc_attr( $current_date ); ?>"
				data-month-name="<?php echo esc_attr( $month_name ); ?>">
				<div class="day-number"><?php echo esc_html( $day_num ); ?></div>

				<?php if ( ! empty( $day_events ) ) : ?>
				<div class="day-events">
					<?php foreach ( $day_events as $occurrence ) : ?>
						<?php fair_events_render_calendar_event_item( $occurrence, $bg_color_value, $text_color_value ); ?>
					<?php endforeach; ?>
				</div>
				<?php endif; ?>
			</div>
				<?php
			endfor;
			?>
		</div>
	</div>
	<?php if ( class_exists( \FairAudience\Services\Branding::class ) ) : ?>
		<?php echo wp_kses_post( \FairAudience\Services\Branding::block_html() ); ?>
	<?php endif; ?>
</div>
<?php if ( null !== $item_list ) : ?>
	<script type="application/ld+json">
	<?php echo wp_json_encode( $item_list, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ); ?>

	</script>
<?php endif; ?>
