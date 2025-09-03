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
$start_hour = $attributes['startHour'] ?? '09:00';
$end_hour   = $attributes['endHour'] ?? '10:00';

// Get timetable context for offset calculation
$timetable_start_hour = $block->context['fair-timetable/startHour'] ?? '09:00';

// Initialize TimeSlot object
$time_slot = new TimeSlot(
	array(
		'startHour' => $start_hour,
		'endHour'   => $end_hour,
	),
	array(
		'fair-timetable/startHour' => $timetable_start_hour,
	)
);

// Calculate offset and duration from TimeSlot class
$offset_hours = $time_slot->calculateOffset();
$duration     = $time_slot->calculateDuration();

// Build CSS custom properties
$css_vars = sprintf(
	'--time-slot-length: %s; --time-slot-offset: %s;',
	esc_attr( $duration ),
	esc_attr( $offset_hours )
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
	<h4 class="time-annotation"><?php echo esc_html( $start_hour . '-' . $end_hour ); ?></h4>
	<?php echo wp_kses_post( $content ); ?>
</div>
