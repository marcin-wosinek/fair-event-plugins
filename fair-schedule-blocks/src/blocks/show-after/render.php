<?php
/**
 * Server-side rendering for Show After block
 *
 * @package FairScheduleBlocks
 */

defined( 'WPINC' ) || die;

// Get block attributes
$show_after = $attributes['showAfter'] ?? '';

// If no date is set or the current time is before the show date, don't render
if ( ! empty( $show_after ) ) {
	try {
		// Parse ISO string and convert to site timezone
		$show_time = new DateTime( $show_after );
		$show_time->setTimezone( wp_timezone() );
		$current_time = current_datetime();

		// If current time is before show time, don't render
		if ( $current_time < $show_time ) {
			return '';
		}
	} catch ( Exception $e ) {
		// If date parsing fails, don't render
		return '';
	}
}

// Get wrapper attributes
$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class'           => 'show-after-container',
		'data-show-after' => esc_attr( $show_after ),
	)
);
?>

<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<?php echo wp_kses_post( $content ); ?>
</div>
