<?php
/**
 * Server-side rendering for Time Column Body block
 *
 * @package FairTimetable
 */

defined( 'WPINC' ) || die;

// Get wrapper attributes
$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class' => 'time-column-body-container',
	)
);
?>

<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<?php echo wp_kses_post( $content ); ?>
</div>
