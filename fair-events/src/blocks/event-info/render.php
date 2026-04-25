<?php
/**
 * Event Info Block - Server-side rendering
 *
 * @package FairEvents
 *
 * @var array    $attributes Block attributes.
 * @var string   $content    Block default content.
 * @var WP_Block $block      Block instance.
 */

defined( 'WPINC' ) || die;

// Get post ID from block context.
$post_id = $block->context['postId'] ?? get_the_ID();

// Only render if we have a post ID.
if ( ! $post_id ) {
	return '';
}

// Get event data from custom table.
$event_dates = \FairEvents\Models\EventDates::get_by_event_id( $post_id );

// Don't render if no event data.
if ( ! $event_dates ) {
	return '';
}

$event_start   = $event_dates->start_datetime;
$event_end     = $event_dates->end_datetime;
$event_all_day = $event_dates->all_day;
$venue_id      = $event_dates->venue_id;

// Get venue data if available.
$venue = null;
if ( $venue_id ) {
	$venue = \FairEvents\Models\Venue::get_by_id( $venue_id );
}

$formatted_date = \FairEvents\Helpers\DateRangeFormatter::format( $event_start, $event_end, $event_all_day );

/**
 * Format recurrence description from an RRULE string
 *
 * @param string $rrule          RRULE string (e.g. "FREQ=WEEKLY;COUNT=10").
 * @param string $start_datetime Start datetime to derive day-of-week.
 * @return string Recurrence description (e.g. "Every Wednesday").
 */
if ( ! function_exists( 'fair_events_format_recurrence_description' ) ) {
	function fair_events_format_recurrence_description( $rrule, $start_datetime ) {
		$parsed = \FairEvents\Services\RecurrenceService::parse_rrule( $rrule );
		$freq   = $parsed['freq'] ?? 'WEEKLY';

		$start_timestamp = \FairEvents\Helpers\DateHelper::local_to_timestamp( $start_datetime );
		$day_name        = $start_timestamp ? wp_date( 'l', $start_timestamp ) : '';

		$interval = $parsed['interval'] ?? 1;

		switch ( $freq ) {
			case 'DAILY':
				if ( $interval > 1 ) {
					/* translators: %d: number of days */
					return sprintf( __( 'Every %d days', 'fair-events' ), $interval );
				}
				return __( 'Daily', 'fair-events' );

			case 'WEEKLY':
				if ( $interval === 2 ) {
					/* translators: %s: day of week */
					return sprintf( __( 'Every 2 weeks on %s', 'fair-events' ), $day_name );
				}
				if ( $interval > 2 ) {
					/* translators: 1: number of weeks, 2: day of week */
					return sprintf( __( 'Every %1$d weeks on %2$s', 'fair-events' ), $interval, $day_name );
				}
				/* translators: %s: day of week */
				return sprintf( __( 'Every %s', 'fair-events' ), $day_name );

			case 'MONTHLY':
				if ( $interval > 1 ) {
					/* translators: %d: number of months */
					return sprintf( __( 'Every %d months', 'fair-events' ), $interval );
				}
				return __( 'Monthly', 'fair-events' );

			case 'YEARLY':
				if ( $interval > 1 ) {
					/* translators: %d: number of years */
					return sprintf( __( 'Every %d years', 'fair-events' ), $interval );
				}
				return __( 'Yearly', 'fair-events' );

			default:
				return '';
		}
	}
}

/**
 * Format time range for recurring events (without the date portion)
 *
 * @param string $start_datetime Start datetime string.
 * @param string $end_datetime   End datetime string.
 * @return string Formatted time range (e.g. "19:30—21:30").
 */
if ( ! function_exists( 'fair_events_format_time_range' ) ) {
	function fair_events_format_time_range( $start_datetime, $end_datetime ) {
		$start_timestamp = \FairEvents\Helpers\DateHelper::local_to_timestamp( $start_datetime );
		if ( false === $start_timestamp ) {
			return '';
		}

		$start_time = wp_date( 'H:i', $start_timestamp );

		if ( $end_datetime ) {
			$end_timestamp = \FairEvents\Helpers\DateHelper::local_to_timestamp( $end_datetime );
			if ( $end_timestamp ) {
				$end_time = wp_date( 'H:i', $end_timestamp );
				return $start_time . '—' . $end_time;
			}
		}

		return $start_time;
	}
}

// Determine if this is a recurring master event.
$is_recurring    = 'master' === $event_dates->occurrence_type && ! empty( $event_dates->rrule );
$next_occurrence = null;

if ( $is_recurring ) {
	// Check if master date itself is upcoming.
	$now             = current_time( 'mysql' );
	$master_upcoming = $event_start >= $now;

	if ( $master_upcoming ) {
		$next_occurrence = $event_dates;
	} else {
		$next_occurrence = \FairEvents\Models\EventDates::get_next_upcoming_by_master_id( $event_dates->id );
	}
}
?>

<div <?php echo wp_kses_post( get_block_wrapper_attributes( array( 'class' => 'wp-block-fair-events-event-info' ) ) ); ?>>
	<?php if ( $is_recurring ) : ?>
		<?php
		$recurrence_desc = fair_events_format_recurrence_description( $event_dates->rrule, $event_start );
		if ( ! $event_all_day ) {
			$time_range      = fair_events_format_time_range( $event_start, $event_end );
			$recurrence_desc = $recurrence_desc . ', ' . $time_range;
		}
		?>
		<div class="wp-block-fair-events-event-info__dates">
			<?php echo esc_html( $recurrence_desc ); ?>
		</div>
		<?php if ( $next_occurrence ) : ?>
			<?php
			$next_timestamp = \FairEvents\Helpers\DateHelper::local_to_timestamp( $next_occurrence->start_datetime );
			$next_date_str  = $next_timestamp ? wp_date( 'j F', $next_timestamp ) : '';
			?>
			<div class="wp-block-fair-events-event-info__next-occurrence">
				<?php
				/* translators: %s: date of next occurrence */
				echo esc_html( sprintf( __( 'Next: %s', 'fair-events' ), $next_date_str ) );
				?>
			</div>
		<?php endif; ?>
	<?php else : ?>
		<div class="wp-block-fair-events-event-info__dates">
			<?php echo esc_html( $formatted_date ); ?>
		</div>
	<?php endif; ?>
	<?php if ( $venue ) : ?>
		<div class="wp-block-fair-events-event-info__venue">
			<div class="wp-block-fair-events-event-info__venue-name">
				<?php if ( $venue->google_maps_link ) : ?>
					<a href="<?php echo esc_url( $venue->google_maps_link ); ?>" target="_blank" rel="noopener noreferrer">
						<?php echo esc_html( $venue->name ); ?>
					</a>
				<?php else : ?>
					<?php echo esc_html( $venue->name ); ?>
				<?php endif; ?>
			</div>
			<?php if ( $venue->address ) : ?>
				<div class="wp-block-fair-events-event-info__venue-address">
					<?php echo esc_html( $venue->address ); ?>
				</div>
			<?php endif; ?>
		</div>
	<?php endif; ?>
</div>
