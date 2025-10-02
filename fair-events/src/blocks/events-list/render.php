<?php
/**
 * Events List Block - Server-side rendering
 *
 * @package FairEvents
 *
 * @var array    $attributes Block attributes.
 * @var string   $content    Block default content.
 * @var WP_Block $block      Block instance.
 */

defined( 'WPINC' ) || die;

// Get block attributes
$time_filter = $attributes['timeFilter'] ?? 'upcoming';
$categories  = $attributes['categories'] ?? array();

// Placeholder content - actual implementation coming soon
?>
<div <?php echo get_block_wrapper_attributes(); ?>>
	<p><?php esc_html_e( 'Events List Block - Coming Soon', 'fair-events' ); ?></p>
	<p>
		<?php
		/* translators: %s: time filter value */
		printf( esc_html__( 'Time Filter: %s', 'fair-events' ), esc_html( $time_filter ) );
		?>
	</p>
	<?php if ( ! empty( $categories ) ) : ?>
		<p>
			<?php
			/* translators: %s: comma-separated category IDs */
			printf( esc_html__( 'Categories: %s', 'fair-events' ), esc_html( implode( ', ', $categories ) ) );
			?>
		</p>
	<?php endif; ?>
</div>
