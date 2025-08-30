<?php
/**
 * Server-side rendering for Time Slot block
 *
 * @package FairTimetable
 */

defined( 'WPINC' ) || die;

// Get block attributes
$start_hour = $attributes['startHour'] ?? '09:00';
$end_hour = $attributes['endHour'] ?? '10:00';
$length = $attributes['length'] ?? 1;

// Get timetable context for offset calculation
$timetable_start_hour = $block->context['fair-timetable/startHour'] ?? '09:00';

// Calculate slot duration in hours
$start_time = DateTime::createFromFormat('H:i', $start_hour);
$end_time = DateTime::createFromFormat('H:i', $end_hour);

// If end time is before start time, assume next day
if ($end_time <= $start_time) {
    $end_time->add(new DateInterval('P1D'));
}

$interval = $start_time->diff($end_time);
$slot_hours = ($interval->days * 24) + $interval->h + ($interval->i / 60);

// Calculate offset from timetable start
$timetable_start_time = DateTime::createFromFormat('H:i', $timetable_start_hour);
$slot_start_time = DateTime::createFromFormat('H:i', $start_hour);

$offset_interval = $timetable_start_time->diff($slot_start_time);
$offset_hours = (($offset_interval->h * 60) + $offset_interval->i) / 60;

// If slot start is before timetable start, add 24 hours (next day)
if ($offset_hours < 0) {
    $offset_hours += 24;
}

// Build CSS custom properties
$css_vars = sprintf(
    '--slot-duration: %s; --slot-length: %s; --time-slot-length: %s; --time-slot-offset: %s;',
    esc_attr($slot_hours),
    esc_attr($length),
    esc_attr($length),
    esc_attr($offset_hours)
);

// Get wrapper attributes
$wrapper_attributes = get_block_wrapper_attributes([
    'class' => 'time-slot-container',
    'style' => $css_vars,
]);
?>

<div <?php echo $wrapper_attributes; ?>>
    <?php echo $content; ?>
</div>
