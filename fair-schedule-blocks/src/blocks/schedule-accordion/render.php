<?php
/**
 * Server-side rendering for Schedule Accordion block
 *
 * @package FairScheduleBlocks
 */

defined( 'WPINC' ) || die;

// Get block attributes
$auto_collapsed_after = $attributes['autoCollapsedAfter'] ?? 3;

// Get wrapper attributes
$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class'                     => 'schedule-accordion-container',
		'data-auto-collapsed-after' => esc_attr( $auto_collapsed_after ),
	)
);
?>

<div <?php echo $wrapper_attributes; ?>>
	<div class="schedule-accordion-content">
		<?php echo $content; ?>
	</div>
</div>