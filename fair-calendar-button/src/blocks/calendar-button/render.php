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
$start = $attributes['start'] ?? '';
$end = $attributes['end'] ?? '';
$all_day = $attributes['allDay'] ?? false;
$description = $attributes['description'] ?? '';
$location = $attributes['location'] ?? '';
$recurring = $attributes['recurring'] ?? false;
$rrule = $attributes['rRule'] ?? '';

// Get current page/post data
$current_url = get_permalink();
$current_title = get_the_title();

// Build data attributes for JavaScript (including URL functionality)
$data_attributes = sprintf(
    'data-start="%s" data-end="%s" data-all-day="%s" data-description="%s" data-location="%s" data-title="%s" data-recurring="%s" data-rrule="%s" data-url="%s"',
    esc_attr($start),
    esc_attr($end),
    $all_day ? 'true' : 'false',
    esc_attr($description),
    esc_attr($location),
    esc_attr($current_title),
    $recurring ? 'true' : 'false',
    esc_attr($rrule),
    esc_attr($current_url)
);

// Add data attributes to the button within the content
$content_with_attributes = preg_replace(
    '/(<a[^>]*class="[^"]*wp-block-button__link[^"]*"[^>]*)(>)/',
    '$1 ' . $data_attributes . '$2',
    $content
);
?>

<div <?php echo wp_kses_data( get_block_wrapper_attributes() ); ?>>
    <?php echo wp_kses_post( $content_with_attributes ); ?>
</div>
