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
use FairEvents\Helpers\EventSchema;
use FairEvents\Services\EventFeedProvider;
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
		// setISODate() lands on the Monday (weekday 1). Step back to whichever
		// weekday start_of_week configures (0 = Sunday .. 6 = Saturday).
		$days_back = ( 1 - $start_of_week + 7 ) % 7;
		if ( $days_back > 0 ) {
			$date->modify( "-{$days_back} days" );
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

// Fetch occurrences for the week from the shared provider and bucket by day.
$provider    = new EventFeedProvider();
$occurrences = $provider->get_occurrences(
	$week_start,
	$week_end,
	array(
		'categories'         => $categories,
		'event_source_slugs' => $event_sources,
		'include_drafts'     => $show_drafts,
	)
);

$occurrences_by_date = EventFeedProvider::group_by_day( $occurrences, $week_start, $week_end );

$item_list = EventSchema::item_list_from_occurrences( $occurrences );

// Map each day's occurrence DTOs to the shape the template renders.
$events_by_date = array();
foreach ( $occurrences_by_date as $date => $day_occurrences ) {
	$events_by_date[ $date ] = array_map(
		static function ( $occ ) {
			$is_external = 'external' === $occ['occurrence_type'];

			return array(
				'title'      => $occ['title'],
				'permalink'  => $occ['url'],
				'all_day'    => $occ['all_day'],
				'start_time' => $occ['all_day'] ? '' : DateHelper::local_time( $occ['start'] ),
				'is_ical'    => $is_external,
				'is_draft'   => $occ['is_draft'],
				'color'      => $occ['source_color'],
			);
		},
		$day_occurrences
	);
}

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
	$page_url      = get_permalink( get_queried_object_id() );
	$page_label    = $page_url ? $page_title . ' (' . $page_url . ')' : $page_title;
	$summary_lines = array( $page_label . ', ' . $nav_title . ':' );

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

					$ev_bg   = $bg_color_value;
					$ev_text = $text_color_value;
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
	<div class="fair-events-copy-summary"
		data-wp-interactive="fair-events/copy-summary"
		<?php
		echo wp_interactivity_data_wp_context( // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- self-escaping (JSON-encodes and esc_attr()'s internally).
			array(
				'copied'      => false,
				'summary'     => $summary_text,
				'copyLabel'   => __( 'Copy summary', 'fair-events' ),
				'copiedLabel' => '✓',
			)
		);
		?>
	>
		<div class="wp-block-button is-style-outline">
			<button
				class="fair-events-copy-summary-btn wp-block-button__link wp-element-button"
				type="button"
				data-wp-on--click="actions.copy"
				data-wp-text="state.label"
			></button>
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
