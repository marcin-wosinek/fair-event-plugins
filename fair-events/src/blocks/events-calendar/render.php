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

use FairEvents\Models\EventDates;
use FairEvents\Helpers\ICalParser;
use FairEvents\Helpers\FairEventsApiParser;
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
 * Render event using block pattern
 *
 * Takes a pattern name and event ID, sets up WordPress post data context,
 * retrieves the pattern from the WordPress pattern registry, parses it,
 * and renders the resulting blocks within the event's post context.
 *
 * This allows calendar events to be displayed using customizable block patterns
 * while maintaining proper WordPress post template tags (like the_title, get_permalink).
 *
 * @param string $pattern_name Pattern name to render (e.g., 'fair-events/calendar-event-simple').
 * @param int    $event_id     Event post ID to render.
 * @return string Rendered pattern HTML output.
 */
if ( ! function_exists( 'fair_events_render_calendar_pattern' ) ) {
	function fair_events_render_calendar_pattern( $pattern_name, $event_id ) {
		$event_post = get_post( $event_id );
		if ( ! $event_post ) {
			return '';
		}

		// Set up post data for template tags to work
		// This makes WordPress template tags (the_title, the_permalink, etc.) work in the pattern
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
			$pattern_content = '<!-- wp:post-title {"level":5,"isLink":true,"fontSize":"small"} /-->';
		}

		// Parse and render blocks
		// Block parser converts pattern's block markup into block arrays
		$parsed_blocks = parse_blocks( $pattern_content );
		$output        = '';
		foreach ( $parsed_blocks as $block ) {
			$output .= render_block( $block );
		}

		wp_reset_postdata();
		return $output;
	}
}

/*
 * Calendar Rendering Logic
 *
 * This block uses a hybrid server-side rendering approach:
 * 1. Reads month/year from URL parameters (for navigation) or block attributes
 * 2. Validates and sanitizes date inputs
 * 3. Queries events for the month using QueryHelper (efficient single query)
 * 4. Groups events by date (handling multi-day events)
 * 5. Calculates calendar grid structure (leading/trailing blank cells)
 * 6. Renders events using customizable block patterns
 * 7. Highlights current day, marks past days
 * 8. Responsive: Desktop shows full grid, mobile shows only event days
 */

// Get block attributes
$start_of_week   = $attributes['startOfWeek'] ?? 1;
$show_navigation = $attributes['showNavigation'] ?? true;
$categories      = $attributes['categories'] ?? array();
$display_pattern = $attributes['displayPattern'] ?? 'fair-events/calendar-event-simple';
$show_drafts     = $attributes['showDrafts'] ?? false;
$bg_color        = $attributes['backgroundColor'] ?? 'primary';
$text_color      = $attributes['textColor'] ?? '#ffffff';
$event_sources   = $attributes['eventSources'] ?? array();

// Convert WordPress event colors to CSS values (used for all WordPress events)
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

// Adjust for Monday start (startOfWeek attribute)
if ( 1 === $start_of_week ) {
	$first_weekday = ( 0 === $first_weekday ) ? 6 : $first_weekday - 1;
}

$leading_blanks  = $first_weekday;
$total_cells     = $leading_blanks + $days_in_month;
$trailing_blanks = ( 0 === $total_cells % 7 ) ? 0 : 7 - ( $total_cells % 7 );

// Calculate extended query range including adjacent month days
$query_start          = gmdate( 'Y-m-d 00:00:00', strtotime( "-{$leading_blanks} days", $first_day_of_month_ts ) );
$last_day_of_month_ts = strtotime( "{$current_year}-{$current_month}-{$days_in_month}" );
$query_end            = gmdate( 'Y-m-d 23:59:59', strtotime( "+{$trailing_blanks} days", $last_day_of_month_ts ) );

// Keep original month boundaries for display logic
$month_start = "{$current_year}-{$current_month}-01";
$month_end   = "{$current_year}-{$current_month}-{$days_in_month}";

// Build query arguments using QueryHelper (use extended range to include adjacent month days)
$query_args = array(
	'post_type'              => Settings::get_enabled_post_types(),
	'posts_per_page'         => -1,
	'post_status'            => $show_drafts ? array( 'publish', 'draft' ) : 'publish',
	'fair_events_date_query' => array(
		'start_before' => $query_end,
		'end_after'    => $query_start,
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

// Remove the filters after the query is complete
remove_filter( 'posts_join', array( 'FairEvents\\Helpers\\QueryHelper', 'join_dates_table' ), 10 );
remove_filter( 'posts_where', array( 'FairEvents\\Helpers\\QueryHelper', 'filter_by_dates' ), 10 );
remove_filter( 'posts_orderby', array( 'FairEvents\\Helpers\\QueryHelper', 'order_by_dates' ), 10 );

// Fetch iCal events from selected event sources
$all_ical_events    = array();
$event_source_slugs = $event_sources; // Now contains array of slugs

if ( ! empty( $event_source_slugs ) && is_array( $event_source_slugs ) ) {
	$repository = new \FairEvents\Database\EventSourceRepository();

	foreach ( $event_source_slugs as $slug ) {
		// Skip if not a string (handles old format gracefully)
		if ( ! is_string( $slug ) ) {
			continue;
		}

		$source = $repository->get_by_slug( $slug );

		// Skip disabled or non-existent sources
		if ( ! $source || ! $source['enabled'] ) {
			continue;
		}

		// Process each data source within the event source
		foreach ( $source['data_sources'] as $data_source ) {
			if ( 'ical_url' === $data_source['source_type'] ) {
				$ical_feed_url   = $data_source['config']['url'] ?? '';
				$ical_feed_color = $data_source['config']['color'] ?? '#4caf50';

				if ( ! empty( $ical_feed_url ) ) {
					$fetched_events  = ICalParser::fetch_and_parse( $ical_feed_url );
					$filtered_events = ICalParser::filter_events_for_month( $fetched_events, $query_start, $query_end );

					// Add color to each event
					foreach ( $filtered_events as $event ) {
						$event['source_color'] = $ical_feed_color;
						$all_ical_events[]     = $event;
					}
				}
			}

			if ( 'fair_events_api' === $data_source['source_type'] ) {
				$api_url   = $data_source['config']['url'] ?? '';
				$api_color = $data_source['config']['color'] ?? '#4caf50';

				if ( ! empty( $api_url ) ) {
					// Extract date parts for API query
					$api_start_date  = gmdate( 'Y-m-d', strtotime( $query_start ) );
					$api_end_date    = gmdate( 'Y-m-d', strtotime( $query_end ) );
					$fetched_events  = FairEventsApiParser::fetch_and_parse( $api_url, $api_start_date, $api_end_date );
					$filtered_events = FairEventsApiParser::filter_events_for_month( $fetched_events, $query_start, $query_end );

					// Add color and mark as external API event
					foreach ( $filtered_events as $event ) {
						$event['source_color'] = $api_color;
						$event['is_fair_api']  = true;
						$all_ical_events[]     = $event;
					}
				}
			}
		}
	}
}

// Group events by date (handle multi-day events and recurring events for both local and iCal)
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
			$start_date = gmdate( 'Y-m-d', strtotime( $event_dates->start_datetime ) );
			$end_date   = $event_dates->end_datetime
				? gmdate( 'Y-m-d', strtotime( $event_dates->end_datetime ) )
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
					'title'        => get_the_title( $event_id ),
					'permalink'    => get_permalink( $event_id ),
				);

				$loop_date = gmdate( 'Y-m-d', strtotime( $loop_date . ' +1 day' ) );
			}
		}
	}
}

// Process iCal events
foreach ( $all_ical_events as $ical_event ) {
	$start_date = gmdate( 'Y-m-d', strtotime( $ical_event['start'] ) );
	$end_date   = gmdate( 'Y-m-d', strtotime( $ical_event['end'] ) );

	// Add event to all days it spans
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

		$loop_date = gmdate( 'Y-m-d', strtotime( $loop_date . ' +1 day' ) );
	}
}

wp_reset_postdata();

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
					<?php foreach ( $day_events as $event_data ) : ?>
						<?php
						$is_ical = $event_data['is_ical'] ?? false;

						if ( $is_ical ) {
							// iCal event rendering
							$event_title = esc_html( $event_data['title'] );
							$event_url   = $event_data['permalink'] ?? '';
							$event_desc  = esc_attr( $event_data['description'] ?? '' );

							$item_classes = array( 'event-item', 'is-ical' );
							?>
							<div class="<?php echo esc_attr( implode( ' ', $item_classes ) ); ?>"
								style="--event-bg-color: <?php echo esc_attr( $bg_color_value ); ?>; --event-text-color: <?php echo esc_attr( $text_color_value ); ?>">
								<?php if ( ! empty( $event_url ) ) : ?>
									<a href="<?php echo esc_url( $event_url ); ?>"
										class="ical-event-title"
										title="<?php echo $event_desc; ?>"
										target="_blank"
										rel="noopener noreferrer">
										<?php echo $event_title; ?>
									</a>
								<?php else : ?>
									<span class="ical-event-title" title="<?php echo $event_desc; ?>">
										<?php echo $event_title; ?>
									</span>
								<?php endif; ?>
							</div>
						<?php } else { ?>
							<?php
							// Local WordPress event rendering
							$event_post  = get_post( $event_data['id'] );
							$is_draft    = $event_post && 'draft' === $event_post->post_status;
							$event_title = get_the_title( $event_data['id'] );
							$event_url   = get_permalink( $event_data['id'] );

							$item_classes = array( 'event-item' );
							if ( $is_draft ) {
								$item_classes[] = 'is-draft';
							}
							?>
							<div class="<?php echo esc_attr( implode( ' ', $item_classes ) ); ?>"
								style="--event-bg-color: <?php echo esc_attr( $bg_color_value ); ?>; --event-text-color: <?php echo esc_attr( $text_color_value ); ?>">
								<a href="<?php echo esc_url( $event_url ); ?>" class="event-title">
									<?php echo esc_html( $event_title ); ?>
								</a>
							</div>
						<?php } ?>
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
					<?php foreach ( $day_events as $event_data ) : ?>
						<?php
						$is_ical = $event_data['is_ical'] ?? false;

						if ( $is_ical ) {
							// iCal event rendering
							$event_title = esc_html( $event_data['title'] );
							$event_url   = $event_data['permalink'] ?? '';
							$event_desc  = esc_attr( $event_data['description'] ?? '' );

							$item_classes = array( 'event-item', 'is-ical' );
							?>
							<div class="<?php echo esc_attr( implode( ' ', $item_classes ) ); ?>"
								style="--event-bg-color: <?php echo esc_attr( $bg_color_value ); ?>; --event-text-color: <?php echo esc_attr( $text_color_value ); ?>">
								<?php if ( ! empty( $event_url ) ) : ?>
									<a href="<?php echo esc_url( $event_url ); ?>"
										class="ical-event-title"
										title="<?php echo $event_desc; ?>"
										target="_blank"
										rel="noopener noreferrer">
										<?php echo $event_title; ?>
									</a>
								<?php else : ?>
									<span class="ical-event-title" title="<?php echo $event_desc; ?>">
										<?php echo $event_title; ?>
									</span>
								<?php endif; ?>
							</div>
						<?php } else { ?>
							<?php
							// Local WordPress event rendering
							$event_post  = get_post( $event_data['id'] );
							$is_draft    = $event_post && 'draft' === $event_post->post_status;
							$event_title = get_the_title( $event_data['id'] );
							$event_url   = get_permalink( $event_data['id'] );

							$item_classes = array( 'event-item' );
							if ( $is_draft ) {
								$item_classes[] = 'is-draft';
							}
							?>
							<div class="<?php echo esc_attr( implode( ' ', $item_classes ) ); ?>"
								style="--event-bg-color: <?php echo esc_attr( $bg_color_value ); ?>; --event-text-color: <?php echo esc_attr( $text_color_value ); ?>">
								<a href="<?php echo esc_url( $event_url ); ?>" class="event-title">
									<?php echo esc_html( $event_title ); ?>
								</a>
							</div>
						<?php } ?>
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
					<?php foreach ( $day_events as $event_data ) : ?>
						<?php
						$is_ical = $event_data['is_ical'] ?? false;

						if ( $is_ical ) {
							// iCal event rendering
							$event_title = esc_html( $event_data['title'] );
							$event_url   = $event_data['permalink'] ?? '';
							$event_desc  = esc_attr( $event_data['description'] ?? '' );

							$item_classes = array( 'event-item', 'is-ical' );
							?>
							<div class="<?php echo esc_attr( implode( ' ', $item_classes ) ); ?>"
								style="--event-bg-color: <?php echo esc_attr( $bg_color_value ); ?>; --event-text-color: <?php echo esc_attr( $text_color_value ); ?>">
								<?php if ( ! empty( $event_url ) ) : ?>
									<a href="<?php echo esc_url( $event_url ); ?>"
										class="ical-event-title"
										title="<?php echo $event_desc; ?>"
										target="_blank"
										rel="noopener noreferrer">
										<?php echo $event_title; ?>
									</a>
								<?php else : ?>
									<span class="ical-event-title" title="<?php echo $event_desc; ?>">
										<?php echo $event_title; ?>
									</span>
								<?php endif; ?>
							</div>
						<?php } else { ?>
							<?php
							// Local WordPress event rendering
							$event_post  = get_post( $event_data['id'] );
							$is_draft    = $event_post && 'draft' === $event_post->post_status;
							$event_title = get_the_title( $event_data['id'] );
							$event_url   = get_permalink( $event_data['id'] );

							$item_classes = array( 'event-item' );
							if ( $is_draft ) {
								$item_classes[] = 'is-draft';
							}
							?>
							<div class="<?php echo esc_attr( implode( ' ', $item_classes ) ); ?>"
								style="--event-bg-color: <?php echo esc_attr( $bg_color_value ); ?>; --event-text-color: <?php echo esc_attr( $text_color_value ); ?>">
								<a href="<?php echo esc_url( $event_url ); ?>" class="event-title">
									<?php echo esc_html( $event_title ); ?>
								</a>
							</div>
						<?php } ?>
					<?php endforeach; ?>
				</div>
				<?php endif; ?>
			</div>
				<?php
			endfor;
			?>
		</div>
	</div>
</div>
