<?php

namespace FairTimetable\Core;

defined( 'WPINC' ) || die;

/**
 * Render callback for the time slot block
 *
 * @package FairTimetable
 * @param  array $attributes Block attributes
 * @param  string $content Block content  
 * @param  WP_Block $block Block instance
 * @return string Rendered block HTML
 */

// Extract attributes with defaults
$title = $attributes['title'] ?? '';
$start_hour = $attributes['startHour'] ?? '09:00';
$end_hour = $attributes['endHour'] ?? '10:00';

// Get context from parent timetable column
$column_start_hour = $block->context['fair-timetable/startHour'] ?? '09:00';
$hour_height = $block->context['fair-timetable/hourHeight'] ?? 2.5;

// Calculate hour offset between column start and time-slot start
$hour_offset = 0;
if ($start_hour && $column_start_hour) {
    $column_start_time = \DateTime::createFromFormat('H:i', $column_start_hour);
    $slot_start_time = \DateTime::createFromFormat('H:i', $start_hour);
    
    if ($column_start_time && $slot_start_time) {
        $interval = $column_start_time->diff($slot_start_time);
        $hour_offset = $interval->h + ($interval->i / 60);
        
        // Handle negative offset if slot starts before column
        if ($slot_start_time < $column_start_time) {
            $hour_offset = -$hour_offset;
        }
    }
}

// Calculate slot duration in hours
$slot_duration = 1; // default 1 hour
if ($start_hour && $end_hour) {
    $slot_start_time = \DateTime::createFromFormat('H:i', $start_hour);
    $slot_end_time = \DateTime::createFromFormat('H:i', $end_hour);
    
    if ($slot_start_time && $slot_end_time) {
        $duration_interval = $slot_start_time->diff($slot_end_time);
        $slot_duration = $duration_interval->h + ($duration_interval->i / 60);
    }
}

// Calculate positioning and sizing
$top_position = $hour_offset * $hour_height;
$block_height = $slot_duration * $hour_height;

// Prepare wrapper attributes
$wrapper_attributes = get_block_wrapper_attributes([
    'class' => 'time-slot-block',
    'style' => sprintf(
        'position: absolute; top: %sem; left: 0; right: 0; height: %sem;',
        esc_attr($top_position),
        esc_attr($block_height)
    ),
    'data-start-hour' => esc_attr($start_hour),
    'data-end-hour' => esc_attr($end_hour),
    'data-hour-offset' => esc_attr($hour_offset)
]);
?>

<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
    <div class="time-slot">
        <span class="time-range">
            <?php echo esc_html($start_hour); ?> - <?php echo esc_html($end_hour); ?>
        </span>
        <?php if (!empty($title)): ?>
            <h5 class="event-title">
                <?php echo wp_kses_post($title); ?>
            </h5>
        <?php endif; ?>
    </div>
</div>