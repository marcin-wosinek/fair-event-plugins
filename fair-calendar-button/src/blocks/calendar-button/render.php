<?php
/**
 * Render callback for the calendar button block
 *
 * @param  array $attributes Block attributes
 * @param  string $content Block content
 * @param  WP_Block $block Block instance
 * @return string Rendered block HTML
 */

// Extract attributes with defaults
$button_text = $attributes['buttonText'] ?? 'Add to Calendar';
$start = $attributes['start'] ?? '';
$end = $attributes['end'] ?? '';
$all_day = $attributes['allDay'] ?? false;
$description = $attributes['description'] ?? '';
$location = $attributes['location'] ?? '';

// Get current page/post data
$current_url = get_permalink();
$current_title = get_the_title();

// Build data attributes for JavaScript
$data_attributes = sprintf(
    'data-start="%s" data-end="%s" data-all-day="%s" data-description="%s" data-location="%s" data-url="%s" data-title="%s"',
    esc_attr($start),
    esc_attr($end),
    $all_day ? 'true' : 'false',
    esc_attr($description),
    esc_attr($location),
    esc_attr($current_url),
    esc_attr($current_title)
);
?>

<div <?php echo get_block_wrapper_attributes(); ?>>
    <button <?php echo $data_attributes; ?>>
        <?php echo esc_html($button_text); ?>
    </button>
</div>
