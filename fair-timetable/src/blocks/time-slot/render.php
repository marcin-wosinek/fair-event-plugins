<?php
/**
 * Server-side rendering for Time Slot block
 *
 * @package FairTimetable
 */

defined( 'WPINC' ) || die;

// Import TimeSlot class
use FairTimetable\TimeSlot;

// Get block attributes
$start_time = $attributes['startTime'] ?? '09:00';
$end_time   = $attributes['endTime'] ?? '10:00';

// Get timetable context for offset calculation
$timetable_start_time = $block->context['fair-timetable/startTime'] ?? '09:00';

// Initialize TimeSlot object
$time_slot = new TimeSlot(
	array(
		'startTime' => $start_time,
		'endTime'   => $end_time,
	),
	array(
		'fair-timetable/startTime' => $timetable_start_time,
	)
);

// Calculate time from start and duration from TimeSlot class
$time_from_start_hours = $time_slot->calculateTimeFromStart();
$duration              = $time_slot->getDuration();

// Build CSS custom properties
$css_vars = sprintf(
	'--time-slot-length: %s; --time-slot-time-from-start: %s;',
	esc_attr( $duration ),
	esc_attr( $time_from_start_hours )
);

// Get wrapper attributes
$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class' => 'time-slot-container',
		'style' => $css_vars,
	)
);
?>

<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<h4 class="time-annotation"><?php echo esc_html( $start_time . '-' . $end_time ); ?></h4>
	<?php echo wp_kses_post( $content ); ?>
</div>
