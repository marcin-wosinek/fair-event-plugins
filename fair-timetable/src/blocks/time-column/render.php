<?php
/**
 * Server-side rendering for Time Column block
 *
 * @package FairTimetable
 */

defined( 'WPINC' ) || die;

// Get context from parent timetable
$context_start_time  = $context['fair-timetable/startTime'] ?? '09:00';
$context_end_time    = $context['fair-timetable/endTime'] ?? '17:00';
$context_hour_height = $context['fair-timetable/hourHeight'] ?? 4;

// Build CSS custom properties from context
$css_vars = sprintf(
	'--context-start-time: %s; --context-end-time: %s; --context-hour-height: %d;',
	esc_attr( $context_start_time ),
	esc_attr( $context_end_time ),
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
