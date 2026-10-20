<?php
/**
 * Other Sessions Block - Server-side rendering
 *
 * @package FairEvents
 *
 * @var array    $attributes Block attributes.
 * @var string   $content    Block default content.
 * @var WP_Block $block      Block instance.
 */

defined( 'WPINC' ) || die;

// Get post ID from block context.
$context_post_id = $block->context['postId'] ?? get_the_ID();

// The editor's ServerSideRender preview comes through the block-renderer
// REST route; front-end renders never do. Only the preview explains why the
// block is empty — visitors see nothing on a page without a recurring event.
$is_editor_preview = defined( 'REST_REQUEST' ) && REST_REQUEST;

// WordPress keeps only what this file prints, so every exit prints (or not)
// and then returns.
$print_editor_placeholder = static function ( $message ) use ( $is_editor_preview ) {
	if ( $is_editor_preview ) {
		echo '<p class="wp-block-fair-events-other-sessions__editor-placeholder">' . esc_html( $message ) . '</p>';
	}
};

$result = $context_post_id
	? \FairEvents\Helpers\OtherSessions::for_post( $context_post_id, $attributes['maxSessions'] ?? \FairEvents\Helpers\OtherSessions::DEFAULT_LIMIT )
	: null;

if ( ! $result ) {
	$print_editor_placeholder(
		$context_post_id && \FairEvents\Models\EventDates::get_by_event_id( $context_post_id )
			? __( 'Other Sessions block is disabled — the event linked to this post is not recurring.', 'fair-events' )
			: __( 'Other Sessions block is disabled — no event is linked to this post.', 'fair-events' )
	);
	return;
}

if ( \FairEvents\Helpers\OtherSessions::DRAFT === $result['state'] ) {
	$print_editor_placeholder( __( 'Other Sessions block is hidden from visitors — this recurring event is a draft.', 'fair-events' ) );
	return;
}

$is_session     = \FairEvents\Helpers\SelectedOccurrence::SESSION === $result['state'];
$is_unavailable = \FairEvents\Helpers\SelectedOccurrence::UNAVAILABLE === $result['state'];
$sessions       = $result['sessions'];

$list_label  = $is_session ? __( 'Other upcoming sessions', 'fair-events' ) : __( 'Upcoming sessions', 'fair-events' );
$empty_label = $is_session ? __( 'There are no other upcoming sessions.', 'fair-events' ) : __( 'There are no upcoming sessions.', 'fair-events' );
?>
<div <?php echo wp_kses_post( get_block_wrapper_attributes( array( 'class' => 'wp-block-fair-events-other-sessions' ) ) ); ?>>
	<?php if ( $is_unavailable ) : ?>
		<p class="wp-block-fair-events-other-sessions__status">
			<?php esc_html_e( 'The selected session is unavailable.', 'fair-events' ); ?>
		</p>
	<?php endif; ?>
	<?php if ( empty( $sessions ) ) : ?>
		<p class="wp-block-fair-events-other-sessions__empty">
			<?php echo esc_html( $empty_label ); ?>
		</p>
	<?php else : ?>
		<nav aria-label="<?php echo esc_attr( $list_label ); ?>">
			<ul class="wp-block-fair-events-other-sessions__list">
				<?php foreach ( $sessions as $session ) : ?>
					<li class="wp-block-fair-events-other-sessions__item">
						<?php if ( $session['url'] ) : ?>
							<a class="wp-block-fair-events-other-sessions__date" href="<?php echo esc_url( $session['url'] ); ?>"><?php echo esc_html( $session['date'] ); ?></a>
						<?php else : ?>
							<span class="wp-block-fair-events-other-sessions__date"><?php echo esc_html( $session['date'] ); ?></span>
						<?php endif; ?>
						<?php if ( $session['all_day'] ) : ?>
							<span class="wp-block-fair-events-other-sessions__detail"><?php esc_html_e( 'All day', 'fair-events' ); ?></span>
						<?php endif; ?>
						<?php if ( '' !== $session['location'] ) : ?>
							<span class="wp-block-fair-events-other-sessions__detail wp-block-fair-events-other-sessions__location"><?php echo esc_html( $session['location'] ); ?></span>
						<?php endif; ?>
						<?php if ( 'online' === $session['mode'] || 'hybrid' === $session['mode'] ) : ?>
							<span class="wp-block-fair-events-other-sessions__detail"><?php echo esc_html( 'online' === $session['mode'] ? __( 'Online event', 'fair-events' ) : __( 'Hybrid event', 'fair-events' ) ); ?></span>
						<?php endif; ?>
					</li>
				<?php endforeach; ?>
			</ul>
		</nav>
	<?php endif; ?>
</div>
