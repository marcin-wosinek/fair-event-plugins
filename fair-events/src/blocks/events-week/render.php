<?php
/**
 * Events Week View Block - Server-side rendering
 *
 * Displays events for the current week in a 7-day grid with inline times,
 * similar to the fair-audience admin weekly schedule page.
 *
 * @package FairEvents
 *
 * @var array    $attributes Block attributes.
 * @var string   $content    Block default content.
 * @var WP_Block $block      Block instance.
 *
 * phpcs:disable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound
 */

defined( 'WPINC' ) || die;

use FairEvents\Helpers\DateHelper;
use FairEvents\Models\EventDates;
use FairEvents\Helpers\ICalParser;
use FairEvents\Helpers\FairEventsApiParser;
use FairEvents\Settings\Settings;

// Helper functions — guarded so they compose safely with weekly-schedule on the same page.
if ( ! function_exists( 'fair_events_parse_iso_week' ) ) {
	function fair_events_parse_iso_week( $iso_week_string ) {
		if ( ! preg_match( '/^(\d{4})-W(\d{2})$/', $iso_week_string, $matches ) ) {
			return null;
		}
		$year = (int) $matches[1];
		$week = (int) $matches[2];
		if ( $year < 1900 || $year > 2100 || $week < 1 || $week > 53 ) {
			return null;
		}
		return array(
			'year' => $year,
			'week' => $week,
		);
	}
}

if ( ! function_exists( 'fair_events_get_current_week' ) ) {
	function fair_events_get_current_week() {
		$now = new DateTime( 'now', new DateTimeZone( wp_timezone_string() ) );
		return array(
			'year' => (int) $now->format( 'o' ),
			'week' => (int) $now->format( 'W' ),
		);
	}
}

if ( ! function_exists( 'fair_events_get_week_boundaries' ) ) {
	function fair_events_get_week_boundaries( $year, $week, $start_of_week ) {
		$date = new DateTime();
		$date->setISODate( $year, $week );
		if ( 0 === $start_of_week ) {
			$date->modify( '-1 day' );
		}
		$week_start = $date->format( 'Y-m-d' );
		$date->modify( '+6 days' );
		$week_end = $date->format( 'Y-m-d' );
		return array(
			'start' => $week_start,
			'end'   => $week_end,
		);
	}
}

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

// Resolve which week to show — URL param takes precedence over current week.
// phpcs:ignore WordPress.Security.NonceVerification.Recommended
$url_week_param = isset( $_GET['week_view'] ) ? sanitize_text_field( wp_unslash( $_GET['week_view'] ) ) : '';
$parsed         = fair_events_parse_iso_week( $url_week_param );

if ( $parsed ) {
	$year = $parsed['year'];
	$week = $parsed['week'];
} else {
	$current = fair_events_get_current_week();
	$year    = $current['year'];
	$week    = $current['week'];
}

// Block attributes.
$start_of_week     = Settings::get_start_of_week();
$show_navigation   = $attributes['showNavigation'] ?? true;
$categories        = $attributes['categories'] ?? array();
$show_drafts       = $attributes['showDrafts'] ?? false;
$event_sources     = $attributes['eventSources'] ?? array();
$show_copy_summary = $attributes['showCopySummary'] ?? false;

$bg_color   = $attributes['backgroundColor'] ?? 'primary';
$text_color = $attributes['textColor'] ?? '#ffffff';

if ( preg_match( '/^#[0-9A-Fa-f]{3,6}$/', $bg_color ) ) {
	$bg_color_value = $bg_color;
} else {
	$bg_color_value = 'var(--wp--preset--color--' . esc_attr( $bg_color ) . ')';
}
if ( preg_match( '/^#[0-9A-Fa-f]{3,6}$/', $text_color ) ) {
	$text_color_value = $text_color;
} else {
	$text_color_value = 'var(--wp--preset--color--' . esc_attr( $text_color ) . ')';
}

// Week date range.
$boundaries = fair_events_get_week_boundaries( $year, $week, $start_of_week );
$week_start = $boundaries['start'] . ' 00:00:00';
$week_end   = $boundaries['end'] . ' 23:59:59';

// Build WP_Query arguments.
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

add_filter( 'posts_join', array( 'FairEvents\\Helpers\\QueryHelper', 'join_dates_table' ), 10, 2 );
add_filter( 'posts_where', array( 'FairEvents\\Helpers\\QueryHelper', 'filter_by_dates' ), 10, 2 );
add_filter( 'posts_orderby', array( 'FairEvents\\Helpers\\QueryHelper', 'order_by_dates' ), 10, 2 );

$events_query = new WP_Query( $query_args );

remove_filter( 'posts_join', array( 'FairEvents\\Helpers\\QueryHelper', 'join_dates_table' ), 10 );
remove_filter( 'posts_where', array( 'FairEvents\\Helpers\\QueryHelper', 'filter_by_dates' ), 10 );
remove_filter( 'posts_orderby', array( 'FairEvents\\Helpers\\QueryHelper', 'order_by_dates' ), 10 );

// Fetch iCal / Fair Events API sources.
$all_ical_events = array();

if ( ! empty( $event_sources ) && is_array( $event_sources ) ) {
	$repository = new \FairEvents\Database\EventSourceRepository();

	foreach ( $event_sources as $slug ) {
		if ( ! is_string( $slug ) ) {
			continue;
		}
		$source = $repository->get_by_slug( $slug );
		if ( ! $source || ! $source['enabled'] ) {
			continue;
		}

		foreach ( $source['data_sources'] as $data_source ) {
			if ( 'ical_url' === $data_source['source_type'] ) {
				$ical_url   = $data_source['config']['url'] ?? '';
				$ical_color = $data_source['config']['color'] ?? '#4caf50';

				if ( ! empty( $ical_url ) ) {
					$fetched  = ICalParser::fetch_and_parse( $ical_url );
					$filtered = ICalParser::filter_events_for_month( $fetched, $week_start, $week_end );
					foreach ( $filtered as $ev ) {
						$ev['source_color'] = $ical_color;
						$all_ical_events[]  = $ev;
					}
				}
			}

			if ( 'fair_events_api' === $data_source['source_type'] ) {
				$api_url   = $data_source['config']['url'] ?? '';
				$api_color = $data_source['config']['color'] ?? '#4caf50';

				if ( ! empty( $api_url ) ) {
					$api_start = DateHelper::local_date( $week_start );
					$api_end   = DateHelper::local_date( $week_end );
					$fetched   = FairEventsApiParser::fetch_and_parse( $api_url, $api_start, $api_end );
					$filtered  = FairEventsApiParser::filter_events_for_month( $fetched, $week_start, $week_end );
					foreach ( $filtered as $ev ) {
						$ev['source_color'] = $api_color;
						$ev['is_fair_api']  = true;
						$all_ical_events[]  = $ev;
					}
				}
			}
		}
	}
}

// Group events by date, carrying start/end time so we can display inline.
$events_by_date   = array();
$processed_events = array();

if ( $events_query->have_posts() ) {
	while ( $events_query->have_posts() ) {
		$events_query->the_post();
		$event_id = get_the_ID();

		if ( isset( $processed_events[ $event_id ] ) ) {
			continue;
		}
		$processed_events[ $event_id ] = true;

		$all_occurrences = EventDates::get_all_by_event_id( $event_id );
		$event_post      = get_post( $event_id );
		$is_draft        = $event_post && 'draft' === $event_post->post_status;

		foreach ( $all_occurrences as $occ ) {
			$start_date = DateHelper::local_date( $occ->start_datetime );
			$end_date   = $occ->end_datetime
				? DateHelper::local_date( $occ->end_datetime )
				: $start_date;

			// Only include days within the displayed week.
			$loop_date = $start_date;
			while ( $loop_date <= $end_date && $loop_date <= $boundaries['end'] ) {
				if ( $loop_date < $boundaries['start'] ) {
					$loop_date = DateHelper::next_date( $loop_date );
					continue;
				}

				if ( ! isset( $events_by_date[ $loop_date ] ) ) {
					$events_by_date[ $loop_date ] = array();
				}

				$permalink = ! empty( $occ->id )
					? add_query_arg( 'event_date', (int) $occ->id, get_permalink( $event_id ) )
					: get_permalink( $event_id );

				$events_by_date[ $loop_date ][] = array(
					'id'         => $event_id,
					'title'      => get_the_title( $event_id ),
					'permalink'  => $permalink,
					'all_day'    => (bool) $occ->all_day,
					'start_time' => $occ->all_day ? '' : DateHelper::local_time( $occ->start_datetime ),
					'sort_key'   => $occ->all_day ? '00:00' : DateHelper::local_time( $occ->start_datetime ),
					'is_ical'    => false,
					'is_draft'   => $is_draft,
					'color'      => null,
				);

				$loop_date = DateHelper::next_date( $loop_date );
			}
		}
	}
}

// Standalone events.
$standalone_events = EventDates::get_standalone_for_date_range( $week_start, $week_end, $categories );
foreach ( $standalone_events as $occ ) {
	$start_date = DateHelper::local_date( $occ->start_datetime );
	$end_date   = $occ->end_datetime
		? DateHelper::local_date( $occ->end_datetime )
		: $start_date;

	$loop_date = $start_date;
	while ( $loop_date <= $end_date && $loop_date <= $boundaries['end'] ) {
		if ( $loop_date < $boundaries['start'] ) {
			$loop_date = DateHelper::next_date( $loop_date );
			continue;
		}

		if ( ! isset( $events_by_date[ $loop_date ] ) ) {
			$events_by_date[ $loop_date ] = array();
		}

		$events_by_date[ $loop_date ][] = array(
			'id'         => 'standalone_' . $occ->id,
			'title'      => $occ->get_display_title(),
			'permalink'  => $occ->get_display_url(),
			'all_day'    => (bool) $occ->all_day,
			'start_time' => $occ->all_day ? '' : DateHelper::local_time( $occ->start_datetime ),
			'sort_key'   => $occ->all_day ? '00:00' : DateHelper::local_time( $occ->start_datetime ),
			'is_ical'    => false,
			'is_draft'   => false,
			'color'      => null,
		);

		$loop_date = DateHelper::next_date( $loop_date );
	}
}

// iCal events.
foreach ( $all_ical_events as $ical_event ) {
	$start_date = DateHelper::local_date( $ical_event['start'] );
	$end_date   = DateHelper::local_date( $ical_event['end'] );

	$loop_date = $start_date;
	while ( $loop_date <= $end_date && $loop_date <= $boundaries['end'] ) {
		if ( $loop_date < $boundaries['start'] ) {
			$loop_date = DateHelper::next_date( $loop_date );
			continue;
		}

		if ( ! isset( $events_by_date[ $loop_date ] ) ) {
			$events_by_date[ $loop_date ] = array();
		}

		$start_time = DateHelper::local_time( $ical_event['start'] );

		$events_by_date[ $loop_date ][] = array(
			'id'         => 'ical_' . md5( $ical_event['uid'] ),
			'title'      => $ical_event['summary'],
			'permalink'  => $ical_event['url'] ?? '',
			'all_day'    => false,
			'start_time' => $start_time,
			'sort_key'   => $start_time,
			'is_ical'    => true,
			'is_draft'   => false,
			'color'      => $ical_event['source_color'],
		);

		$loop_date = DateHelper::next_date( $loop_date );
	}
}

wp_reset_postdata();

// Sort events within each day by start time.
foreach ( $events_by_date as &$day_events ) {
	usort(
		$day_events,
		static function ( $a, $b ) {
			return strcmp( $a['sort_key'], $b['sort_key'] );
		}
	);
}
unset( $day_events );

// Build the 7-day array.
$days        = array();
$current_day = new DateTime( $boundaries['start'], new DateTimeZone( wp_timezone_string() ) );
$today       = current_time( 'Y-m-d' );

for ( $i = 0; $i < 7; $i++ ) {
	$date_str = $current_day->format( 'Y-m-d' );
	$days[]   = array(
		'date'     => $date_str,
		'weekday'  => wp_date( 'D', $current_day->getTimestamp() ),
		'day_num'  => $current_day->format( 'j' ),
		'events'   => $events_by_date[ $date_str ] ?? array(),
		'is_today' => $date_str === $today,
		'is_past'  => $date_str < $today,
	);
	$current_day->modify( '+1 day' );
}

// Navigation: format the header as a date range (e.g. "16–22 Jun 2026").
$start_ts      = strtotime( $boundaries['start'] );
$end_ts        = strtotime( $boundaries['end'] );
$start_month   = wp_date( 'M', $start_ts );
$end_month     = wp_date( 'M', $end_ts );
$start_year    = wp_date( 'Y', $start_ts );
$end_year      = wp_date( 'Y', $end_ts );
$start_day_num = wp_date( 'j', $start_ts );
$end_day_num   = wp_date( 'j', $end_ts );

if ( $start_year !== $end_year ) {
	$nav_title = sprintf( '%s %s – %s %s %s', $start_day_num, $start_month, $end_day_num, $end_month, $end_year );
} elseif ( $start_month !== $end_month ) {
	$nav_title = sprintf( '%s %s – %s %s %s', $start_day_num, $start_month, $end_day_num, $end_month, $end_year );
} else {
	$nav_title = sprintf( '%s–%s %s %s', $start_day_num, $end_day_num, $end_month, $end_year );
}

$prev     = fair_events_offset_week( $year, $week, -1 );
$next     = fair_events_offset_week( $year, $week, 1 );
$prev_url = add_query_arg( 'week_view', sprintf( '%04d-W%02d', $prev['year'], $prev['week'] ) );
$next_url = add_query_arg( 'week_view', sprintf( '%04d-W%02d', $next['year'], $next['week'] ) );

// Build copy summary text.
$summary_text = '';
if ( $show_copy_summary ) {
	$page_title    = get_the_title( get_queried_object_id() );
	$summary_lines = array( $page_title . ', ' . $nav_title . ':' );

	foreach ( $days as $day ) {
		foreach ( $day['events'] as $ev ) {
			$line = '* ' . $day['weekday'];
			if ( ! $ev['all_day'] && ! empty( $ev['start_time'] ) ) {
				$line .= ', ' . $ev['start_time'];
			}
			$line .= ', ' . $ev['title'];
			if ( ! empty( $ev['permalink'] ) ) {
				$line .= ': ' . $ev['permalink'];
			}
			$summary_lines[] = $line;
		}
	}

	$summary_text = implode( "\n", $summary_lines );
}

?>
<div <?php echo wp_kses_post( get_block_wrapper_attributes( array( 'class' => 'wp-block-fair-events-events-week' ) ) ); ?>>

	<?php if ( $show_navigation ) : ?>
	<div class="fair-events-navigation">
		<a href="<?php echo esc_url( $prev_url ); ?>" class="nav-prev">
			<?php esc_html_e( 'Previous', 'fair-events' ); ?>
		</a>
		<h2 class="navigation-title">
			<?php echo esc_html( $nav_title ); ?>
		</h2>
		<a href="<?php echo esc_url( $next_url ); ?>" class="nav-next">
			<?php esc_html_e( 'Next', 'fair-events' ); ?>
		</a>
	</div>
	<?php endif; ?>

	<div class="week-grid" role="grid" aria-label="<?php echo esc_attr( $nav_title ); ?>">
		<?php foreach ( $days as $day ) : ?>
		<div class="week-day<?php echo $day['is_today'] ? ' is-today' : ''; ?><?php echo $day['is_past'] ? ' is-past' : ''; ?>"
			role="gridcell"
			data-date="<?php echo esc_attr( $day['date'] ); ?>">

			<div class="week-day-header">
				<span class="week-day-name"><?php echo esc_html( $day['weekday'] ); ?></span>
				<span class="week-day-num"><?php echo esc_html( $day['day_num'] ); ?></span>
			</div>

			<div class="week-day-events">
				<?php foreach ( $day['events'] as $ev ) : ?>
					<?php
					$classes = array( 'week-event' );
					if ( $ev['all_day'] ) {
						$classes[] = 'is-all-day';
					}
					if ( $ev['is_ical'] ) {
						$classes[] = 'is-ical';
					}
					if ( $ev['is_draft'] ) {
						$classes[] = 'is-draft';
					}

					$ev_bg   = $ev['color'] ?? $bg_color_value;
					$ev_text = $ev['color'] ? '#ffffff' : $text_color_value;
					$style   = sprintf(
						'--event-bg-color: %s; --event-text-color: %s;',
						esc_attr( $ev_bg ),
						esc_attr( $ev_text )
					);
					?>
					<?php if ( ! empty( $ev['permalink'] ) ) : ?>
					<a href="<?php echo esc_url( $ev['permalink'] ); ?>"
						class="<?php echo esc_attr( implode( ' ', $classes ) ); ?>"
						style="<?php echo esc_attr( $style ); ?>"
						<?php echo $ev['is_ical'] ? 'target="_blank" rel="noopener noreferrer"' : ''; ?>>
						<?php if ( ! $ev['all_day'] && ! empty( $ev['start_time'] ) ) : ?>
							<span class="week-event-time"><?php echo esc_html( $ev['start_time'] ); ?></span>
						<?php endif; ?>
						<span class="week-event-title"><?php echo esc_html( $ev['title'] ); ?></span>
					</a>
					<?php else : ?>
					<span class="<?php echo esc_attr( implode( ' ', $classes ) ); ?>"
						style="<?php echo esc_attr( $style ); ?>">
						<?php if ( ! $ev['all_day'] && ! empty( $ev['start_time'] ) ) : ?>
							<span class="week-event-time"><?php echo esc_html( $ev['start_time'] ); ?></span>
						<?php endif; ?>
						<span class="week-event-title"><?php echo esc_html( $ev['title'] ); ?></span>
					</span>
					<?php endif; ?>
				<?php endforeach; ?>
			</div>
		</div>
		<?php endforeach; ?>
	</div>

	<?php if ( $show_copy_summary && '' !== $summary_text ) : ?>
	<div class="fair-events-copy-summary">
		<button
			class="fair-events-copy-summary-btn"
			data-summary="<?php echo esc_attr( $summary_text ); ?>"
			type="button"
		>
			<?php esc_html_e( 'Copy summary', 'fair-events' ); ?>
		</button>
	</div>
	<?php endif; ?>

	<?php if ( class_exists( \FairAudience\Services\Branding::class ) ) : ?>
		<?php echo wp_kses_post( \FairAudience\Services\Branding::block_html() ); ?>
	<?php endif; ?>

</div>
