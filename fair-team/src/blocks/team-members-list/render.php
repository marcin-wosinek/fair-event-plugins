<?php
/**
 * Team Members List block render callback.
 *
 * @package FairTeam
 */

defined( 'WPINC' ) || die;

( function ( $attributes, $content, $block ) {
	// Get post ID from block context or global
	$post_id = $block->context['postId'] ?? get_the_ID();

	if ( ! $post_id ) {
		return '';
	}

	// Get team members using repository
	$repository   = new \FairTeam\Database\PostTeamMemberRepository();
	$team_members = $repository->get_by_post( $post_id );

	if ( empty( $team_members ) ) {
		return '';
	}

	$wrapper_attributes = get_block_wrapper_attributes(
		array( 'class' => 'fair-team-members-list' )
	);
	?>

	<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
		<ul class="fair-team-members-list__items">
			<?php foreach ( $team_members as $tm ) : ?>
				<?php
				$team_member = get_post( $tm->team_member_id );
				if ( ! $team_member ) {
					continue;
				}

				$instagram_url = get_post_meta( $team_member->ID, 'team_member_instagram', true );
				?>
				<li class="fair-team-members-list__item">
					<?php echo esc_html( $team_member->post_title ); ?>
					<?php if ( ! empty( $instagram_url ) ) : ?>
						<?php
						// Extract Instagram handle from URL (e.g., https://instagram.com/username -> @username)
						$instagram_handle = '';
						if ( preg_match( '/instagram\.com\/([^\/\?]+)/', $instagram_url, $matches ) ) {
							$instagram_handle = '@' . $matches[1];
						} else {
							$instagram_handle = '@instagram';
						}
						?>
						(<a
							href="<?php echo esc_url( $instagram_url ); ?>"
							target="_blank"
							rel="noopener noreferrer"
							class="fair-team-members-list__instagram"
						>
							<?php echo esc_html( $instagram_handle ); ?>
						</a>)
					<?php endif; ?>
				</li>
			<?php endforeach; ?>
		</ul>
	</div>
	<?php
} )( $attributes, $content, $block );
