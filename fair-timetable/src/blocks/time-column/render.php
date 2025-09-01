<?php
/**
 * Server-side rendering for Time Column block
 *
 * @package FairTimetable
 */

defined( 'WPINC' ) || die;

// Get context from parent timetable
$context_start_hour  = $context['fair-timetable/startHour'] ?? '09:00';
$context_end_hour    = $context['fair-timetable/endHour'] ?? '17:00';
$context_hour_height = $context['fair-timetable/hourHeight'] ?? 4;

// Build CSS custom properties from context
$css_vars = sprintf(
	'--context-start-hour: %s; --context-end-hour: %s; --context-hour-height: %d;',
	esc_attr( $context_start_hour ),
	esc_attr( $context_end_hour ),
	esc_attr( $context_hour_height )
);

// Get wrapper attributes
$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class' => 'time-column-container',
		'style' => $css_vars,
	)
);
?>

<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<?php echo wp_kses_post( $content ); ?>
</div>
