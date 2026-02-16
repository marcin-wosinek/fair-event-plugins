<?php
/**
 * Weekly Schedule Block - Server-side Rendering
 *
 * Displays events in a 7-day weekly schedule view with ISO week navigation.
 *
 * @package FairEvents
 *
 * @var array    $attributes Block attributes.
 * @var string   $content    Block default content.
 * @var WP_Block $block      Block instance.
 */

defined( 'WPINC' ) || die;

use FairEvents\Helpers\DateHelper;
use FairEvents\Models\EventDates;
use FairEvents\Helpers\ICalParser;
use FairEvents\Settings\Settings;

/**
 * Parse ISO week string (e.g., "2025-W03")
 *
 * @param string $iso_week_string ISO week format string.
 * @return array|null Array with 'year' and 'week' keys, or null if invalid.
 */
if ( ! function_exists( 'fair_events_parse_iso_week' ) ) {
	function fair_events_parse_iso_week( $iso_week_string ) {
		if ( ! preg_match( '/^(\d{4})-W(\d{2})$/', $iso_week_string, $matches ) ) {
			return null;
		}

		$year = (int) $matches[1];
		$week = (int) $matches[2];

		// Validate year range
		if ( $year < 1900 || $year > 2100 ) {
			return null;
		}

		// Validate week number (1-53)
		if ( $week < 1 || $week > 53 ) {
			return null;
		}

		return array(
			'year' => $year,
			'week' => $week,
		);
	}
}

/**
 * Get current ISO week
 *
 * @return array Array with 'year' and 'week' keys.
 */
if ( ! function_exists( 'fair_events_get_current_week' ) ) {
	function fair_events_get_current_week() {
		$now  = new DateTime( 'now', new DateTimeZone( wp_timezone_string() ) );
		$year = (int) $now->format( 'o' ); // ISO-8601 year number
		$week = (int) $now->format( 'W' ); // ISO-8601 week number

		return array(
			'year' => $year,
			'week' => $week,
		);
	}
}

/**
 * Calculate week start/end dates for given ISO week
 *
 * @param int $year          ISO year.
 * @param int $week          ISO week number (1-53).
 * @param int $start_of_week 0=Sunday, 1=Monday.
 * @return array Array with 'start' and 'end' date strings (Y-m-d format).
 */
if ( ! function_exists( 'fair_events_get_week_boundaries' ) ) {
	function fair_events_get_week_boundaries( $year, $week, $start_of_week ) {
		// Create DateTime for ISO week
		$date = new DateTime();
		$date->setISODate( $year, $week );

		// ISO weeks always start on Monday
		// If start_of_week is Sunday (0), adjust to start on previous Sunday
		if ( 0 === $start_of_week ) {
			$date->modify( '-1 day' );
		}

		$week_start = $date->format( 'Y-m-d' );

		// Calculate end date (6 days later)
		$date->modify( '+6 days' );
		$week_end = $date->format( 'Y-m-d' );

		return array(
			'start' => $week_start,
			'end'   => $week_end,
		);
	}
}

/**
 * Navigate weeks (add/subtract weeks)
 *
 * @param int $year   Current year.
 * @param int $week   Current week number.
 * @param int $offset Weeks to add (+1) or subtract (-1).
 * @return array Array with 'year' and 'week' keys.
 */
if ( ! function_exists( 'fair_events_offset_week' ) ) {
	function fair_events_offset_week( $year, $week, $offset ) {
		$date = new DateTime();
		$date->setISODate( $year, $week );
		$date->modify( sprintf( '%+d weeks', $offset ) );

		return array(
			'year' => (int) $date->format( 'o' ),
			'week' => (int) $date->format( 'W' ),
		);
	}
}

/**
 * Inject actual event times into pattern HTML
 *
 * Replaces <time> placeholders with actual event times or removes them for all-day events.
 *
 * @param string $html       Pattern HTML with <time> placeholders.
 * @param string $start_date Event start datetime.
 * @param string $end_date   Event end datetime.
 * @param bool   $all_day    Whether event is all-day.
 * @return string HTML with times injected or <time> removed.
 */
if ( ! function_exists( 'fair_events_inject_event_time' ) ) {
	function fair_events_inject_event_time( $html, $start_date, $end_date, $all_day ) {
		// Remove time elements for all-day events
		if ( $all_day ) {
			$html = preg_replace( '/<time[^>]*>.*?<\/time>/is', '', $html );
			return $html;
		}

		// Format times
		$start_time = DateHelper::local_time( $start_date );
		$end_time   = $end_date ? DateHelper::local_time( $end_date ) : '';

		// Replace start time placeholder
		$html = preg_replace(
			'/<time\s+data-event-time="start"[^>]*><\/time>/i',
			'<time>' . esc_html( $start_time ) . '</time>',
			$html
		);

		// Replace time range placeholder
		if ( $end_time && $start_time !== $end_time ) {
			$time_range = $start_time . '–' . $end_time;
		} else {
			$time_range = $start_time;
		}

		$html = preg_replace(
			'/<time\s+data-event-time="range"[^>]*><\/time>/i',
			'<time>' . esc_html( $time_range ) . '</time>',
			$html
		);

		return $html;
	}
}

/**
 * Render event using block pattern with time injection
 *
 * @param string $pattern_name Pattern name to render.
 * @param int    $event_id     Event post ID.
 * @return string Rendered pattern HTML output.
 */
if ( ! function_exists( 'fair_events_render_schedule_pattern' ) ) {
	function fair_events_render_schedule_pattern( $pattern_name, $event_id ) {
		$event_post = get_post( $event_id );
		if ( ! $event_post ) {
			return '';
		}

		// Set up post data for template tags
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
		$GLOBALS['post'] = $event_post;
		setup_postdata( $event_post );

		// Get pattern content from registry
		$all_patterns    = WP_Block_Patterns_Registry::get_instance()->get_all_registered();
		$pattern_content = '';
		foreach ( $all_patterns as $pattern ) {
			if ( $pattern['name'] === $pattern_name ) {
				$pattern_content = $pattern['content'];
				break;
			}
		}

		// Fallback to simple title link if pattern not found
		if ( empty( $pattern_content ) ) {
			$pattern_content = '<!-- wp:post-title {"level":6,"isLink":true,"fontSize":"small"} /-->';
		}

		// Parse and render blocks
		$parsed_blocks = parse_blocks( $pattern_content );
		$output        = '';
		foreach ( $parsed_blocks as $block ) {
			$output .= render_block( $block );
		}

		// Inject event times if pattern contains time placeholders
		$event_dates = EventDates::get_by_event_id( $event_id );
		if ( $event_dates && strpos( $output, 'data-event-time' ) !== false ) {
			$output = fair_events_inject_event_time(
				$output,
				$event_dates->start_datetime,
				$event_dates->end_datetime,
				(bool) $event_dates->all_day
			);
		}

		wp_reset_postdata();
		return $output;
	}
}

// Get block attributes
$start_of_week   = $attributes['startOfWeek'] ?? 1;
$show_navigation = $attributes['showNavigation'] ?? true;
$categories      = $attributes['categories'] ?? array();
$display_pattern = $attributes['displayPattern'] ?? 'fair-events/schedule-event-simple';
$show_drafts     = $attributes['showDrafts'] ?? false;
$bg_color        = $attributes['backgroundColor'] ?? 'primary';
$text_color      = $attributes['textColor'] ?? '#ffffff';
$event_sources   = $attributes['eventSources'] ?? array();

// Convert colors to CSS values
if ( ! function_exists( 'fair_events_convert_color_to_css' ) ) {
	function fair_events_convert_color_to_css( $color ) {
		if ( preg_match( '/^#[0-9A-Fa-f]{3,6}$/', $color ) ) {
			return $color;
		}
		return 'var(--wp--preset--color--' . esc_attr( $color ) . ')';
	}
}

$bg_color_value   = fair_events_convert_color_to_css( $bg_color );
$text_color_value = fair_events_convert_color_to_css( $text_color );

// Parse URL parameter or use block attributes
$url_week_param = isset( $_GET['schedule_week'] ) ? sanitize_text_field( $_GET['schedule_week'] ) : '';
$parsed         = fair_events_parse_iso_week( $url_week_param );

if ( ! $parsed ) {
	// Fallback to block attributes or current week
	$current = fair_events_get_current_week();
	$year    = $attributes['currentYear'] ? (int) $attributes['currentYear'] : $current['year'];
	$week    = $attributes['currentWeek'] ? (int) $attributes['currentWeek'] : $current['week'];

	// Validate week
	if ( $week < 1 || $week > 53 ) {
		$week = $current['week'];
		$year = $current['year'];
	}
} else {
	$year = $parsed['year'];
	$week = $parsed['week'];
}

// Calculate week boundaries
$boundaries = fair_events_get_week_boundaries( $year, $week, $start_of_week );
$week_start = $boundaries['start'] . ' 00:00:00';
$week_end   = $boundaries['end'] . ' 23:59:59';

// Build query arguments
$query_args = array(
	'post_type'              => Settings::get_enabled_post_types(),
	'posts_per_page'         => -1,
	'post_status'            => $show_drafts ? array( 'publish', 'draft' ) : 'publish',
	'fair_events_date_query' => array(
		'start_before' => $week_end,
		'end_after'    => $week_start,
	),
	'fair_events_order'      => 'ASC',
);

// Add category filter if categories are selected
if ( ! empty( $categories ) ) {
	// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
	$query_args['tax_query'] = array(
		array(
			'taxonomy'         => 'category',
			'field'            => 'term_id',
			'terms'            => $categories,
			'include_children' => false,
		),
	);
}

// Hook in the QueryHelper filters
add_filter( 'posts_join', array( 'FairEvents\\Helpers\\QueryHelper', 'join_dates_table' ), 10, 2 );
add_filter( 'posts_where', array( 'FairEvents\\Helpers\\QueryHelper', 'filter_by_dates' ), 10, 2 );
add_filter( 'posts_orderby', array( 'FairEvents\\Helpers\\QueryHelper', 'order_by_dates' ), 10, 2 );

// Execute the query
$events_query = new WP_Query( $query_args );

// Remove the filters
remove_filter( 'posts_join', array( 'FairEvents\\Helpers\\QueryHelper', 'join_dates_table' ), 10 );
remove_filter( 'posts_where', array( 'FairEvents\\Helpers\\QueryHelper', 'filter_by_dates' ), 10 );
remove_filter( 'posts_orderby', array( 'FairEvents\\Helpers\\QueryHelper', 'order_by_dates' ), 10 );

// Fetch iCal events from selected event sources
$all_ical_events    = array();
$event_source_slugs = $event_sources;

if ( ! empty( $event_source_slugs ) && is_array( $event_source_slugs ) ) {
	$repository = new \FairEvents\Database\EventSourceRepository();

	foreach ( $event_source_slugs as $slug ) {
		if ( ! is_string( $slug ) ) {
			continue;
		}

		$source = $repository->get_by_slug( $slug );

		if ( ! $source || ! $source['enabled'] ) {
			continue;
		}

		foreach ( $source['data_sources'] as $data_source ) {
			if ( 'ical_url' === $data_source['source_type'] ) {
				$ical_feed_url   = $data_source['config']['url'] ?? '';
				$ical_feed_color = $data_source['config']['color'] ?? '#4caf50';

				if ( ! empty( $ical_feed_url ) ) {
					$fetched_events  = ICalParser::fetch_and_parse( $ical_feed_url );
					$filtered_events = ICalParser::filter_events_for_month( $fetched_events, $week_start, $week_end );

					foreach ( $filtered_events as $event ) {
						$event['source_color'] = $ical_feed_color;
						$all_ical_events[]     = $event;
					}
				}
			}
		}
	}
}

// Group events by date (supports recurring events)
$events_by_date   = array();
$processed_events = array(); // Track processed event IDs to avoid duplicates from JOIN.
if ( $events_query->have_posts() ) {
	while ( $events_query->have_posts() ) {
		$events_query->the_post();
		$event_id = get_the_ID();

		// Skip if we've already processed this event (JOIN returns duplicates).
		if ( isset( $processed_events[ $event_id ] ) ) {
			continue;
		}
		$processed_events[ $event_id ] = true;

		// Get ALL occurrences for this event (supports recurring events).
		$all_occurrences = EventDates::get_all_by_event_id( $event_id );

		foreach ( $all_occurrences as $event_dates ) {
			$start_date = DateHelper::local_date( $event_dates->start_datetime );
			$end_date   = $event_dates->end_datetime
				? DateHelper::local_date( $event_dates->end_datetime )
				: $start_date;

			// Add event to all days it spans.
			$loop_date = $start_date;
			while ( $loop_date <= $end_date ) {
				if ( ! isset( $events_by_date[ $loop_date ] ) ) {
					$events_by_date[ $loop_date ] = array();
				}

				$events_by_date[ $loop_date ][] = array(
					'id'           => $event_id,
					'is_first_day' => $loop_date === $start_date,
					'is_last_day'  => $loop_date === $end_date,
					'is_ical'      => false,
					'link_type'    => 'post',
				);

				$loop_date = DateHelper::next_date( $loop_date );
			}
		}
	}
}

// Fetch standalone events (external/unlinked) for the week.
$standalone_events = EventDates::get_standalone_for_date_range( $week_start, $week_end, $categories );
foreach ( $standalone_events as $event_dates ) {
	$start_date = DateHelper::local_date( $event_dates->start_datetime );
	$end_date   = $event_dates->end_datetime
		? DateHelper::local_date( $event_dates->end_datetime )
		: $start_date;

	// Add event to all days it spans.
	$loop_date = $start_date;
	while ( $loop_date <= $end_date && $loop_date <= $boundaries['end'] ) {
		// Skip dates before week start.
		if ( $loop_date < $boundaries['start'] ) {
			$loop_date = DateHelper::next_date( $loop_date );
			continue;
		}

		if ( ! isset( $events_by_date[ $loop_date ] ) ) {
			$events_by_date[ $loop_date ] = array();
		}

		$events_by_date[ $loop_date ][] = array(
			'id'            => 'standalone_' . $event_dates->id,
			'is_first_day'  => $loop_date === $start_date,
			'is_last_day'   => $loop_date === $end_date,
			'is_ical'       => false,
			'is_standalone' => true,
			'link_type'     => $event_dates->link_type,
			'title'         => $event_dates->get_display_title(),
			'url'           => $event_dates->get_display_url(),
		);

		$loop_date = DateHelper::next_date( $loop_date );
	}
}

// Process iCal events
foreach ( $all_ical_events as $ical_event ) {
	$start_date = DateHelper::local_date( $ical_event['start'] );
	$end_date   = DateHelper::local_date( $ical_event['end'] );

	$loop_date = $start_date;
	while ( $loop_date <= $end_date ) {
		if ( ! isset( $events_by_date[ $loop_date ] ) ) {
			$events_by_date[ $loop_date ] = array();
		}

		$events_by_date[ $loop_date ][] = array(
			'id'           => 'ical_' . md5( $ical_event['uid'] ),
			'is_first_day' => $loop_date === $start_date,
			'is_last_day'  => $loop_date === $end_date,
			'is_ical'      => true,
			'title'        => $ical_event['summary'],
			'permalink'    => $ical_event['url'],
			'description'  => $ical_event['description'],
			'color'        => $ical_event['source_color'],
		);

		$loop_date = DateHelper::next_date( $loop_date );
	}
}

wp_reset_postdata();

// Generate 7-day array
$days         = array();
$current_date = new DateTime( $boundaries['start'], new DateTimeZone( wp_timezone_string() ) );
$today        = current_time( 'Y-m-d' );

for ( $i = 0; $i < 7; $i++ ) {
	$date_string = $current_date->format( 'Y-m-d' );
	$days[]      = array(
		'date'       => $date_string,
		'weekday'    => wp_date( 'D', $current_date->getTimestamp() ),
		'day_num'    => $current_date->format( 'j' ),
		'events'     => $events_by_date[ $date_string ] ?? array(),
		'is_today'   => $date_string === $today,
		'month_name' => wp_date( 'M', $current_date->getTimestamp() ),
	);
	$current_date->modify( '+1 day' );
}

// Calculate navigation URLs
$prev     = fair_events_offset_week( $year, $week, -1 );
$next     = fair_events_offset_week( $year, $week, 1 );
$prev_url = add_query_arg( 'schedule_week', sprintf( '%04d-W%02d', $prev['year'], $prev['week'] ) );
$next_url = add_query_arg( 'schedule_week', sprintf( '%04d-W%02d', $next['year'], $next['week'] ) );

?>
<div <?php echo wp_kses_post( get_block_wrapper_attributes( array( 'class' => 'weekly-schedule' ) ) ); ?>>
	<?php if ( $show_navigation ) : ?>
	<div class="fair-events-navigation">
		<a href="<?php echo esc_url( $prev_url ); ?>" class="nav-prev">
			<?php esc_html_e( 'Previous', 'fair-events' ); ?>
		</a>
		<h2 class="navigation-title">
			<?php
			// translators: %1$s is the week number, %2$s is the year
			printf( esc_html__( 'Week %1$s, %2$s', 'fair-events' ), esc_html( $week ), esc_html( $year ) );
			?>
		</h2>
		<a href="<?php echo esc_url( $next_url ); ?>" class="nav-next">
			<?php esc_html_e( 'Next', 'fair-events' ); ?>
		</a>
	</div>
	<?php endif; ?>

	<div class="schedule-grid" role="grid" aria-label="<?php echo esc_attr( sprintf( 'Week %d, %d', $week, $year ) ); ?>">
		<div class="schedule-header" role="row">
			<?php foreach ( $days as $day ) : ?>
			<div class="day-header" role="columnheader">
				<?php echo esc_html( $day['weekday'] ); ?>
			</div>
			<?php endforeach; ?>
		</div>

		<div class="schedule-body">
			<?php foreach ( $days as $day ) : ?>
			<div class="day-column <?php echo $day['is_today'] ? 'is-today' : ''; ?>"
				role="gridcell"
				data-date="<?php echo esc_attr( $day['date'] ); ?>"
				data-month="<?php echo esc_attr( $day['month_name'] ); ?>">
				<div class="day-number"><?php echo esc_html( $day['day_num'] ); ?></div>
				<div class="day-events">
					<?php foreach ( $day['events'] as $event_data ) : ?>
						<?php if ( $event_data['is_ical'] ) : ?>
							<?php
							// iCal event rendering
							$event_title = esc_html( $event_data['title'] );
							$event_url   = $event_data['permalink'] ?? '';
							$event_desc  = esc_attr( $event_data['description'] ?? '' );
							?>
							<div class="schedule-event is-ical"
								style="--event-bg-color: <?php echo esc_attr( $event_data['color'] ); ?>; --event-text-color: #ffffff;">
								<?php if ( ! empty( $event_url ) ) : ?>
									<a href="<?php echo esc_url( $event_url ); ?>"
										title="<?php echo $event_desc; ?>"
										target="_blank"
										rel="noopener noreferrer">
										<?php echo $event_title; ?>
									</a>
								<?php else : ?>
									<span title="<?php echo $event_desc; ?>">
										<?php echo $event_title; ?>
									</span>
								<?php endif; ?>
							</div>
						<?php elseif ( ! empty( $event_data['is_standalone'] ) ) : ?>
							<?php
							// Standalone event rendering (external/unlinked)
							$event_title  = esc_html( $event_data['title'] ?? '' );
							$event_url    = $event_data['url'] ?? '';
							$is_external  = 'external' === $event_data['link_type'];
							$item_classes = array( 'schedule-event', 'is-standalone' );
							if ( $is_external ) {
								$item_classes[] = 'is-external';
							} else {
								$item_classes[] = 'is-unlinked';
							}
							?>
							<div class="<?php echo esc_attr( implode( ' ', $item_classes ) ); ?>"
								style="--event-bg-color: <?php echo esc_attr( $bg_color_value ); ?>; --event-text-color: <?php echo esc_attr( $text_color_value ); ?>;">
								<?php if ( $is_external && ! empty( $event_url ) ) : ?>
									<a href="<?php echo esc_url( $event_url ); ?>"
										target="_blank"
										rel="noopener noreferrer">
										<?php echo $event_title; ?>
									</a>
								<?php else : ?>
									<span><?php echo $event_title; ?></span>
								<?php endif; ?>
							</div>
						<?php else : ?>
							<?php
							// Local WordPress event rendering
							$event_post   = get_post( $event_data['id'] );
							$is_draft     = $event_post && 'draft' === $event_post->post_status;
							$item_classes = array( 'schedule-event' );
							if ( $is_draft ) {
								$item_classes[] = 'is-draft';
							}
							?>
							<div class="<?php echo esc_attr( implode( ' ', $item_classes ) ); ?>"
								style="--event-bg-color: <?php echo esc_attr( $bg_color_value ); ?>; --event-text-color: <?php echo esc_attr( $text_color_value ); ?>;">
								<?php echo fair_events_render_schedule_pattern( $display_pattern, $event_data['id'] ); ?>
							</div>
						<?php endif; ?>
					<?php endforeach; ?>
				</div>
			</div>
			<?php endforeach; ?>
		</div>
	</div>
</div>
