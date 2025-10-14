<?php
/**
 * Event Dates Block - Server-side rendering
 *
 * @package FairEvents
 *
 * @var array    $attributes Block attributes.
 * @var string   $content    Block default content.
 * @var WP_Block $block      Block instance.
 */

defined( 'WPINC' ) || die;

// Get post ID from block context
$post_id = $block->context['postId'] ?? get_the_ID();

// Only render if we have a post ID
if ( ! $post_id ) {
	return '';
}

// Get event data from custom table
$event_dates = \FairEvents\Models\EventDates::get_by_event_id( $post_id );

// Don't render if no event data
if ( ! $event_dates ) {
	return '';
}

$event_start   = $event_dates->start_datetime;
$event_end     = $event_dates->end_datetime;
$event_all_day = $event_dates->all_day;

/**
 * Format event date range
 *
 * @param string $start_datetime Start datetime string.
 * @param string $end_datetime   End datetime string.
 * @param bool   $all_day        Whether event is all-day.
 * @return string Formatted date range.
 */
if ( ! function_exists( 'fair_events_format_date_range' ) ) {
	function fair_events_format_date_range( $start_datetime, $end_datetime, $all_day ) {
		if ( empty( $start_datetime ) ) {
			return '';
		}

		$start_timestamp = strtotime( $start_datetime );
		if ( false === $start_timestamp ) {
			return $start_datetime;
		}

		$end_timestamp = $end_datetime ? strtotime( $end_datetime ) : null;

		if ( $all_day ) {
			// All-day events: "1-4 October" or "31 October—2 November"
			$start_day   = wp_date( 'j', $start_timestamp );
			$start_month = wp_date( 'F', $start_timestamp );
			$start_year  = wp_date( 'Y', $start_timestamp );

			if ( $end_timestamp ) {
				$end_day   = wp_date( 'j', $end_timestamp );
				$end_month = wp_date( 'F', $end_timestamp );
				$end_year  = wp_date( 'Y', $end_timestamp );

				// Same month and year
				if ( $start_month === $end_month && $start_year === $end_year ) {
					if ( $start_day === $end_day ) {
						// Single day: "15 October"
						return $start_day . ' ' . $start_month;
					} else {
						// Same month: "1-4 October"
						return $start_day . '–' . $end_day . ' ' . $start_month;
					}
				} elseif ( $start_year === $end_year ) {
					// Different months, same year: "31 October—2 November"
					return $start_day . ' ' . $start_month . '—' . $end_day . ' ' . $end_month;
				} else {
					// Different years: "31 December 2024—2 January 2025"
					return $start_day . ' ' . $start_month . ' ' . $start_year . '—' . $end_day . ' ' . $end_month . ' ' . $end_year;
				}
			} else {
				// Only start date: "15 October"
				return $start_day . ' ' . $start_month;
			}
		} else {
			// Timed events: "19:30—21:30, 15th October" or "22:00 15th November—03:00 16 November"
			$start_time  = wp_date( 'H:i', $start_timestamp );
			$start_day   = wp_date( 'jS', $start_timestamp );
			$start_month = wp_date( 'F', $start_timestamp );
			$start_year  = wp_date( 'Y', $start_timestamp );

			if ( $end_timestamp ) {
				$end_time  = wp_date( 'H:i', $end_timestamp );
				$end_day   = wp_date( 'jS', $end_timestamp );
				$end_month = wp_date( 'F', $end_timestamp );
				$end_year  = wp_date( 'Y', $end_timestamp );

				$start_date_str = $start_day . ' ' . $start_month;
				$end_date_str   = $end_day . ' ' . $end_month;

				// Add year if different from current year
				$current_year = wp_date( 'Y' );
				if ( $start_year !== $current_year ) {
					$start_date_str .= ' ' . $start_year;
				}
				if ( $end_year !== $current_year ) {
					$end_date_str .= ' ' . $end_year;
				}

				// Check if same day
				if ( wp_date( 'Y-m-d', $start_timestamp ) === wp_date( 'Y-m-d', $end_timestamp ) ) {
					// Same day: "19:30—21:30, 15th October"
					return $start_time . '—' . $end_time . ', ' . $start_date_str;
				} else {
					// Different days: "22:00 15th November—03:00 16 November"
					return $start_time . ' ' . $start_date_str . '—' . $end_time . ' ' . $end_date_str;
				}
			} else {
				// Only start time: "19:30, 15th October"
				$start_date_str = $start_day . ' ' . $start_month;
				if ( $start_year !== wp_date( 'Y' ) ) {
					$start_date_str .= ' ' . $start_year;
				}
				return $start_time . ', ' . $start_date_str;
			}
		}
	}
}

$formatted_date = fair_events_format_date_range( $event_start, $event_end, $event_all_day );
?>

<div <?php echo wp_kses_post( get_block_wrapper_attributes( array( 'class' => 'event-dates' ) ) ); ?>>
	<?php echo esc_html( $formatted_date ); ?>
</div>
