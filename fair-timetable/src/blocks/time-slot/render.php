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
$start_hour   = $attributes['startHour'] ?? '09:00';
$end_hour     = $attributes['endHour'] ?? '10:00';
$length       = $attributes['length'] ?? 1;
$hide_hours   = $attributes['hideHours'] ?? false;
$display_mode = $attributes['displayMode'] ?? 'full';

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

// Calculate offset from TimeSlot class
$offset_hours = $time_slot->calculateOffset();

// Build CSS custom properties
$css_vars = sprintf(
	'--time-slot-length: %s; --time-slot-offset: %s;',
	esc_attr( $length ),
	esc_attr( $offset_hours )
);

// Build CSS classes
$classes = array( 'time-slot-container' );
if ( $hide_hours ) {
	$classes[] = 'hide-hours';
}
$classes[] = 'display-' . esc_attr( $display_mode );

// Get wrapper attributes
$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class' => implode( ' ', $classes ),
		'style' => $css_vars,
	)
);
?>

<div <?php echo $wrapper_attributes; ?>>
	<?php if ( ! $hide_hours ) : ?>
		<h4 class="time-annotation"><?php echo esc_html( $start_hour . '-' . $end_hour ); ?></h4>
	<?php endif; ?>
	<?php echo $content; ?>
</div>
