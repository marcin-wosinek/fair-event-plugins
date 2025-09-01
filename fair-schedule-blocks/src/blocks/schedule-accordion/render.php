<?php
/**
 * Server-side rendering for Schedule Accordion block
 *
 * @package FairScheduleBlocks
 */

defined( 'WPINC' ) || die;

// Get block attributes
$auto_collapsed_after = $attributes['autoCollapsedAfter'] ?? '';

// Check if the collapse datetime has passed
$classes = array( 'schedule-accordion-container' );
if ( ! empty( $auto_collapsed_after ) ) {
	try {
		// Parse ISO string and convert to site timezone
		$collapse_time = new DateTime( $auto_collapsed_after );
		$collapse_time->setTimezone( wp_timezone() );
		$current_time = current_datetime();

		if ( $current_time > $collapse_time ) {
			$classes[] = 'collapsed';
		}
	}
}

// Get wrapper attributes
$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class'                     => implode( ' ', $classes ),
		'data-auto-collapsed-after' => esc_attr( $auto_collapsed_after ),
	)
);
?>

<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<?php echo wp_kses_post( $content ); ?>
</div>
