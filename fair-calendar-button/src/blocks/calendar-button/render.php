<?php
/**
 * Server-side rendering for Calendar Button block
 *
 * @package FairCalendarButton
 */

defined( 'WPINC' ) || die;

// Extract attributes with defaults
$start       = $attributes['start'] ?? '';
$end         = $attributes['end'] ?? '';
$all_day     = $attributes['allDay'] ?? false;
$description = $attributes['description'] ?? '';
$location    = $attributes['location'] ?? '';
$recurring   = $attributes['recurring'] ?? false;
$rrule       = $attributes['rRule'] ?? '';

// Get current page/post data
$current_url   = get_permalink();
$current_title = get_the_title();

$classes = 'calendar-button-container';

if ( is_plugin_active( 'plausible-analytics/plausible-analytics.php' ) ) {
	$classes .= ' plausible-event-name=Fair+calendar+button';
}

// Get wrapper attributes
$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class'            => esc_attr( $classes ),
		'data-start'       => esc_attr( $start ),
		'data-end'         => esc_attr( $end ),
		'data-all-day'     => $all_day ? 'true' : 'false',
		'data-description' => esc_attr( $description ),
		'data-location'    => esc_attr( $location ),
		'data-title'       => esc_attr( $current_title ),
		'data-recurring'   => $recurring ? 'true' : 'false',
		'data-rrule'       => esc_attr( $rrule ),
		'data-url'         => esc_attr( $current_url ),
	)
);
?>

<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<?php echo wp_kses_post( $content ); ?>
</div>
