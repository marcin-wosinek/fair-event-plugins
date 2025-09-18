<?php
/**
 * Server-side rendering for Timetable block
 *
 * @package FairTimetable
 */

defined( 'WPINC' ) || die;

use FairTimetable\HourlyRange;

// Get block attributes
$start_time  = $attributes['startTime'] ?? '09:00';
$end_time    = $attributes['endTime'] ?? '17:00';
$hour_height = $attributes['hourHeight'] ?? 4;

// Calculate duration from start and end times using HourlyRange
$time_range = new HourlyRange(
	array(
		'startTime' => $start_time,
		'endTime'   => $end_time,
	)
);
$duration   = $time_range->get_duration();

// Build CSS custom properties
$css_vars = sprintf(
	'--hour-height: %d; --column-length: %s;',
	esc_attr( $hour_height ),
	esc_attr( $duration )
);

// Get wrapper attributes
$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class' => 'timetable-container',
		'style' => $css_vars,
	)
);
?>

<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<?php echo wp_kses_post( $content ); ?>
</div>
