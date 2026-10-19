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

// Resolve what this request shows: the page's own event (a recurring
// series' overview, or a single event), a selected session
// (`?event_date=`, or a page linked to one session), or an unavailable
// selection. Never substitutes another session for an explicit selection.
$selection = \FairEvents\Helpers\SelectedOccurrence::select( $post_id );

// Don't render if no event data.
if ( ! $selection ) {
	return '';
}

$selection_state = $selection['state'];
$series          = $selection['series'];

// Link back to the recurring overview: the series' page without
// `event_date`, even when this session has a page of its own.
$overview_url = '';
if ( $series ) {
	$overview_post_id = $series->event_id ? $series->event_id : $series->get_primary_linked_post_id();
	$overview_url     = $overview_post_id ? (string) get_permalink( $overview_post_id ) : '';
} elseif ( \FairEvents\Helpers\SelectedOccurrence::UNAVAILABLE === $selection_state ) {
	$overview_url = (string) get_permalink( $post_id );
}

if ( \FairEvents\Helpers\SelectedOccurrence::UNAVAILABLE === $selection_state ) :
	?>
	<div <?php echo wp_kses_post( get_block_wrapper_attributes( array( 'class' => 'wp-block-fair-events-event-info' ) ) ); ?>>
		<div class="wp-block-fair-events-event-info__status wp-block-fair-events-event-info__status--unavailable">
			<?php esc_html_e( 'This session is unavailable', 'fair-events' ); ?>
		</div>
		<?php if ( $overview_url ) : ?>
			<div class="wp-block-fair-events-event-info__overview-link">
				<a href="<?php echo esc_url( $overview_url ); ?>">
					<?php echo esc_html( $series ? __( 'View recurring event', 'fair-events' ) : __( 'View event', 'fair-events' ) ); ?>
				</a>
			</div>
		<?php endif; ?>
	</div>
	<?php
	return;
endif;

$event_dates = $selection['occurrence'];
$is_session  = \FairEvents\Helpers\SelectedOccurrence::SESSION === $selection_state;

$event_timing  = $event_dates->get_timing();
$event_all_day = $event_dates->all_day;
$venue_id      = $event_dates->venue_id;

// Get venue data if available.
$venue = null;
if ( $venue_id ) {
	$venue = \FairEvents\Models\Venue::get_by_id( $venue_id );
}

// A session may be in any year (often a past one), so it always shows it.
$formatted_date = \FairEvents\Helpers\DateRangeFormatter::format_timing( $event_timing, $is_session );
$session_ended  = $is_session && \FairEvents\Helpers\SessionStatus::has_ended( $event_timing );

/**
 * Format recurrence description from an RRULE string
 *
 * @param string      $rrule      RRULE string (e.g. "FREQ=WEEKLY;COUNT=10").
 * @param string|null $start_date Start date (Y-m-d) to derive day-of-week.
 * @return string Recurrence description (e.g. "Every Wednesday").
 */
if ( ! function_exists( 'fair_events_format_recurrence_description' ) ) {
	function fair_events_format_recurrence_description( $rrule, $start_date ) {
		$parsed = \FairEvents\Services\RecurrenceService::parse_rrule( $rrule );
		$freq   = $parsed['freq'] ?? 'WEEKLY';

		$start_timestamp = $start_date ? \FairEvents\Helpers\DateHelper::local_to_timestamp( $start_date . ' 00:00:00' ) : false;
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
 * @param string|null $start_time Start time (H:i:s), or null.
 * @param string|null $end_time   End time (H:i:s), or null.
 * @return string Formatted time range (e.g. "19:30—21:30"), empty without a start time.
 */
if ( ! function_exists( 'fair_events_format_time_range' ) ) {
	function fair_events_format_time_range( $start_time, $end_time ) {
		if ( null === $start_time ) {
			return '';
		}

		$range = substr( $start_time, 0, 5 );
		if ( null !== $end_time ) {
			$range .= '—' . substr( $end_time, 0, 5 );
		}

		return $range;
	}
}

// The recurring overview describes the series' schedule from its master.
$is_overview     = ! $is_session && 'master' === $event_dates->occurrence_type;
$is_recurring    = $is_overview && ! empty( $event_dates->rrule );
$next_occurrence = null;

if ( $is_overview ) {
	// Check if master date itself is upcoming.
	$master_upcoming = \FairEvents\Helpers\SessionStatus::is_upcoming( $event_dates->get_timing() );

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
		$recurrence_desc = fair_events_format_recurrence_description( $event_dates->rrule, $event_timing['start_date'] );
		$time_range      = $event_all_day ? '' : fair_events_format_time_range( $event_timing['start_time'], $event_timing['end_time'] );
		if ( '' !== $time_range ) {
			$recurrence_desc = $recurrence_desc . ', ' . $time_range;
		}
		?>
		<div class="wp-block-fair-events-event-info__dates">
			<?php echo esc_html( $recurrence_desc ); ?>
		</div>
	<?php else : ?>
		<div class="wp-block-fair-events-event-info__dates">
			<?php echo esc_html( $formatted_date ); ?>
		</div>
	<?php endif; ?>
	<?php if ( $next_occurrence ) : ?>
		<?php
		$next_timestamp = $next_occurrence->start_date ? \FairEvents\Helpers\DateHelper::local_to_timestamp( $next_occurrence->start_date . ' 00:00:00' ) : false;
		$next_date_str  = $next_timestamp ? wp_date( 'j F', $next_timestamp ) : '';
		?>
		<div class="wp-block-fair-events-event-info__next-occurrence">
			<?php
			/* translators: %s: date of next occurrence */
			echo esc_html( sprintf( __( 'Next: %s', 'fair-events' ), $next_date_str ) );
			?>
		</div>
	<?php endif; ?>
	<?php if ( $session_ended ) : ?>
		<div class="wp-block-fair-events-event-info__status wp-block-fair-events-event-info__status--ended">
			<?php esc_html_e( 'This session has ended', 'fair-events' ); ?>
		</div>
	<?php endif; ?>
	<?php if ( $venue ) : ?>
		<div class="wp-block-fair-events-event-info__venue">
			<div class="wp-block-fair-events-event-info__venue-name">
				<?php $maps_url = $venue->get_maps_url(); ?>
				<?php if ( $maps_url ) : ?>
					<a href="<?php echo esc_url( $maps_url ); ?>" target="_blank" rel="noopener noreferrer">
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
	<?php elseif ( ! empty( $event_dates->address ) ) : ?>
		<div class="wp-block-fair-events-event-info__venue">
			<div class="wp-block-fair-events-event-info__venue-address">
				<?php echo nl2br( esc_html( $event_dates->address ) ); ?>
			</div>
		</div>
	<?php endif; ?>
	<?php
	$neutral_location = \FairEvents\Helpers\EventLocation::resolve( $event_dates, $post_id );
	$attendance_mode  = $neutral_location['mode'] ?? ( $event_dates->attendance_mode ?? 'in_person' );
	?>
	<?php if ( 'online' === $attendance_mode || 'hybrid' === $attendance_mode ) : ?>
		<div class="wp-block-fair-events-event-info__attendance-mode">
			<?php echo esc_html( 'online' === $attendance_mode ? __( 'Online event', 'fair-events' ) : __( 'Hybrid event', 'fair-events' ) ); ?>
			<?php if ( ! empty( $neutral_location['joining_url'] ) ) : ?>
				<a href="<?php echo esc_url( $neutral_location['joining_url'] ); ?>" target="_blank" rel="noopener noreferrer">
					<?php esc_html_e( 'Join online', 'fair-events' ); ?>
				</a>
			<?php endif; ?>
		</div>
	<?php endif; ?>
	<?php if ( $is_session && $overview_url ) : ?>
		<div class="wp-block-fair-events-event-info__overview-link">
			<a href="<?php echo esc_url( $overview_url ); ?>">
				<?php esc_html_e( 'View recurring event', 'fair-events' ); ?>
			</a>
		</div>
	<?php endif; ?>
</div>
