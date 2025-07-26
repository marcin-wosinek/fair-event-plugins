<?php
/**
 * Render functions for the Time Block
 *
 * @package FairSchedule
 */

namespace FairSchedule;

/**
 * Render the Time Block
 *
 * @param array $attributes Block attributes.
 * @return string Block HTML.
 */
function render_time_block($attributes) {
    $title = isset($attributes['title']) ? $attributes['title'] : '';
    $link = isset($attributes['link']) ? $attributes['link'] : '';
    $start_hour = isset($attributes['startHour']) ? $attributes['startHour'] : '09:00';
    $end_hour = isset($attributes['endHour']) ? $attributes['endHour'] : '10:00';

    $output = '<div class="time-block">';
    $output .= '<div class="time-slot">';
    $output .= '<span class="time-range">' . esc_html($start_hour) . ' - ' . esc_html($end_hour) . '</span>';
    
    if (!empty($title)) {
        $output .= '<h5 class="event-title">';
        if (!empty($link)) {
            $output .= '<a href="' . esc_url($link) . '" target="_blank" rel="noopener noreferrer">';
            $output .= esc_html($title);
            $output .= '</a>';
        } else {
            $output .= esc_html($title);
        }
        $output .= '</h5>';
    }
    
    $output .= '</div>';
    $output .= '</div>';

    return $output;
}