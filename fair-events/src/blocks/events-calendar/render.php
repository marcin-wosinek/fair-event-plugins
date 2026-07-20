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
 * Build the subscription feed URLs (webcal://, plain https://, and the
 * Google/Outlook subscribe-by-URL deep links) for the configured category
 * filter.
 *
 * Deliberately reflects only the category filter, not the current
 * month/year — a subscription is an ongoing feed, so freezing it to one
 * month is wrong; the feed's own bounded window (-1mo / +12mo) is what a
 * subscriber wants. The block's eventSources and showDrafts filters have no
 * feed equivalent (the feed is public and source-agnostic), so a
 * source-filtered calendar still links the all-sources feed.
 *
 * @param int[] $categories Category term IDs.
 * @return array{webcal: string, https: string, google: string, outlook: string} Feed URLs.
 */
if ( ! function_exists( 'fair_events_build_subscribe_urls' ) ) {
	function fair_events_build_subscribe_urls( array $categories ) {
		$feed_url = rest_url( 'fair-events/v1/calendar.ics' );

		$slugs = array();
		foreach ( $categories as $category_id ) {
			$term = get_term( $category_id, 'category' );
			if ( $term && ! is_wp_error( $term ) ) {
				$slugs[] = $term->slug;
			}
		}

		if ( ! empty( $slugs ) ) {
			$feed_url = add_query_arg( 'categories', implode( ',', $slugs ), $feed_url );
		}

		$webcal_url = preg_replace( '#^https?://#', 'webcal://', $feed_url );

		return array(
			'webcal'  => $webcal_url,
			'https'   => $feed_url,
			'google'  => 'https://calendar.google.com/calendar/r?cid=' . rawurlencode( $webcal_url ),
			'outlook' => add_query_arg(
				array(
					'url'  => rawurlencode( $feed_url ),
					'name' => rawurlencode( get_bloginfo( 'name' ) ),
				),
				'https://outlook.live.com/calendar/0/addfromweb'
			),
		);
	}
}

/**
 * Render an inline brand SVG icon for a subscribe dropdown entry.
 *
 * Uses the same path data as the Font Awesome icons in the add-to-calendar
 * button block's dropdown, so the two menus read as one family.
 *
 * @param string $provider One of 'google', 'outlook', 'apple', 'copy'.
 * @return void Outputs HTML directly.
 */
if ( ! function_exists( 'fair_events_render_subscribe_icon' ) ) {
	function fair_events_render_subscribe_icon( $provider ) {
		$icons = array(
			'google'  => array(
				'viewBox' => '0 0 512 512',
				'path'    => 'M500 261.8C500 403.3 403.1 504 260 504 122.8 504 12 393.2 12 256S122.8 8 260 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9c-88.3-85.2-252.5-21.2-252.5 118.2 0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9l-140.8 0 0-85.3 236.1 0c2.3 12.7 3.9 24.9 3.9 41.4z',
			),
			'outlook' => array(
				'viewBox' => '0 0 448 512',
				'path'    => 'M0 32l214.6 0 0 214.6-214.6 0 0-214.6zm233.4 0l214.6 0 0 214.6-214.6 0 0-214.6zM0 265.4l214.6 0 0 214.6-214.6 0 0-214.6zm233.4 0l214.6 0 0 214.6-214.6 0 0-214.6z',
			),
			'apple'   => array(
				'viewBox' => '0 0 384 512',
				'path'    => 'M319.1 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7-55.8 .9-115.1 44.5-115.1 133.2 0 26.2 4.8 53.3 14.4 81.2 12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zM262.5 104.5c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z',
			),
			'copy'    => array(
				'viewBox' => '0 0 576 512',
				'path'    => 'M419.5 96c-16.6 0-32.7 4.5-46.8 12.7-15.8-16-34.2-29.4-54.5-39.5 28.2-24 64.1-37.2 101.3-37.2 86.4 0 156.5 70 156.5 156.5 0 41.5-16.5 81.3-45.8 110.6l-71.1 71.1c-29.3 29.3-69.1 45.8-110.6 45.8-86.4 0-156.5-70-156.5-156.5 0-1.5 0-3 .1-4.5 .5-17.7 15.2-31.6 32.9-31.1s31.6 15.2 31.1 32.9c0 .9 0 1.8 0 2.6 0 51.1 41.4 92.5 92.5 92.5 24.5 0 48-9.7 65.4-27.1l71.1-71.1c17.3-17.3 27.1-40.9 27.1-65.4 0-51.1-41.4-92.5-92.5-92.5zM275.2 173.3c-1.9-.8-3.8-1.9-5.5-3.1-12.6-6.5-27-10.2-42.1-10.2-24.5 0-48 9.7-65.4 27.1L91.1 258.2c-17.3 17.3-27.1 40.9-27.1 65.4 0 51.1 41.4 92.5 92.5 92.5 16.5 0 32.6-4.4 46.7-12.6 15.8 16 34.2 29.4 54.6 39.5-28.2 23.9-64 37.2-101.3 37.2-86.4 0-156.5-70-156.5-156.5 0-41.5 16.5-81.3 45.8-110.6l71.1-71.1c29.3-29.3 69.1-45.8 110.6-45.8 86.6 0 156.5 70.6 156.5 156.9 0 1.3 0 2.6 0 3.9-.4 17.7-15.1 31.6-32.8 31.2s-31.6-15.1-31.2-32.8c0-.8 0-1.5 0-2.3 0-33.7-18-63.3-44.8-79.6z',
			),
		);

		if ( ! isset( $icons[ $provider ] ) ) {
			return;
		}

		printf(
			'<svg class="fair-events-subscribe-icon" viewBox="%1$s" aria-hidden="true" focusable="false"><path fill="currentColor" d="%2$s"></path></svg>',
			esc_attr( $icons[ $provider ]['viewBox'] ),
			esc_attr( $icons[ $provider ]['path'] )
		);
	}
}

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
$show_subscribe  = $attributes['showSubscribe'] ?? true;

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

// Subscription feed links (webcal:// + copyable https:// fallback).
$subscribe_urls = fair_events_build_subscribe_urls( is_array( $categories ) ? $categories : array() );

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

	<?php if ( $show_subscribe ) : ?>
	<div class="fair-events-subscribe"
		data-wp-interactive="fair-events/calendar-subscribe"
		<?php
		echo wp_interactivity_data_wp_context( // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- self-escaping (JSON-encodes and esc_attr()'s internally).
			array(
				'isOpen'      => false,
				'copied'      => false,
				'feedUrl'     => $subscribe_urls['https'],
				'copyLabel'   => __( 'Copy feed URL', 'fair-events' ),
				'copiedLabel' => '✓',
			)
		);
		?>
		data-wp-on-document--click="actions.handleOutsideClick"
		data-wp-on-document--keydown="actions.handleKeydown"
	>
		<button
			type="button"
			class="fair-events-subscribe-trigger wp-block-button__link wp-element-button is-style-outline"
			aria-haspopup="true"
			data-wp-on--click="actions.toggle"
			data-wp-bind--aria-expanded="state.isOpen"
		>
			<?php esc_html_e( 'Subscribe to calendar', 'fair-events' ); ?>
		</button>

		<div class="fair-events-subscribe-panel"
			role="menu"
			data-wp-class--is-open="state.isOpen"
			data-wp-bind--hidden="!state.isOpen"
		>
			<a
				href="<?php echo esc_url( $subscribe_urls['google'] ); ?>"
				class="fair-events-subscribe-entry"
				role="menuitem"
				target="_blank"
				rel="noopener"
				data-wp-on--click="actions.close"
			>
				<?php fair_events_render_subscribe_icon( 'google' ); ?>
				<?php esc_html_e( 'Google Calendar', 'fair-events' ); ?>
			</a>
			<a
				href="<?php echo esc_url( $subscribe_urls['outlook'] ); ?>"
				class="fair-events-subscribe-entry"
				role="menuitem"
				target="_blank"
				rel="noopener"
				data-wp-on--click="actions.close"
			>
				<?php fair_events_render_subscribe_icon( 'outlook' ); ?>
				<?php esc_html_e( 'Outlook', 'fair-events' ); ?>
			</a>
			<a
				href="<?php echo esc_url( $subscribe_urls['webcal'] ); ?>"
				class="fair-events-subscribe-entry"
				role="menuitem"
				data-wp-on--click="actions.close"
			>
				<?php fair_events_render_subscribe_icon( 'apple' ); ?>
				<?php esc_html_e( 'Apple Calendar', 'fair-events' ); ?>
			</a>
			<button
				type="button"
				class="fair-events-subscribe-entry fair-events-subscribe-entry-copy"
				role="menuitem"
				data-wp-on--click="actions.copy"
			>
				<?php fair_events_render_subscribe_icon( 'copy' ); ?>
				<span data-wp-text="state.label"></span>
			</button>

			<p class="fair-events-subscribe-note">
				<?php esc_html_e( 'Subscribed calendars refresh on your calendar app\'s own schedule (often hours, not instant).', 'fair-events' ); ?>
			</p>
		</div>
	</div>
	<?php endif; ?>

	<?php echo wp_kses_post( \FairEvents\Services\Branding::block_html() ); ?>
</div>
<?php if ( null !== $item_list ) : ?>
	<script type="application/ld+json">
	<?php echo wp_json_encode( $item_list, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ); ?>

	</script>
<?php endif; ?>
