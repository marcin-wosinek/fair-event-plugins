<?php
/**
 * Server-side rendering for Timetable block
 *
 * @package FairTimetable
 */

defined( 'WPINC' ) || die;

// Get block attributes
$length      = $attributes['length'] ?? 8;
$hour_height = $attributes['hourHeight'] ?? 4;

// Build CSS custom properties
$css_vars = sprintf(
	'--hour-height: %d; --column-length: %s;',
	esc_attr( $hour_height ),
	esc_attr( $length )
);

// Get wrapper attributes
$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class' => 'timetable-container',
		'style' => $css_vars,
	)
);
?>

<div <?php echo $wrapper_attributes; ?>>
	<?php echo $content; ?>
</div>
