<?php
/**
 * Registrations page for Fair Registration admin
 *
 * @package FairRegistration
 */

namespace FairRegistration\Admin\Pages;

use FairRegistration\Core\Plugin;

defined( 'WPINC' ) || die;

/**
 * Registrations page class
 */
class RegistrationsPage {

	/**
	 * Render the registrations page
	 *
	 * @param int $form_id Optional. Specific form ID to show registrations for.
	 * @return void
	 */
	public function render( $form_id = null ) {
		// Get form_id from URL parameter if not provided
		if ( ! $form_id && isset( $_GET['form_id'] ) ) {
			$form_id = intval( $_GET['form_id'] );
		}

		$registrations = $this->get_registrations( $form_id );
		$form_title = $form_id ? get_the_title( $form_id ) : '';
		?>
		<div class="wrap">
			<?php if ( $form_id ) : ?>
				<h1>
					<?php printf( 
						esc_html__( 'Registrations: %s', 'fair-registration' ), 
						esc_html( $form_title ) 
					); ?>
					<a href="<?php echo esc_url( admin_url( 'admin.php?page=fair-registration' ) ); ?>" class="page-title-action">
						<?php echo esc_html__( '← Back to Forms', 'fair-registration' ); ?>
					</a>
				</h1>
			<?php else : ?>
				<h1><?php echo esc_html__( 'All Registrations', 'fair-registration' ); ?></h1>
			<?php endif; ?>
			
			<div class="card">
				<?php if ( $form_id ) : ?>
					<h2><?php printf( esc_html__( 'Registrations for "%s"', 'fair-registration' ), esc_html( $form_title ) ); ?></h2>
				<?php else : ?>
					<h2><?php echo esc_html__( 'Recent Registrations', 'fair-registration' ); ?></h2>
				<?php endif; ?>
				
				<div class="tablenav top">
					<div class="alignleft actions">
						<?php if ( ! $form_id ) : ?>
							<select name="form_filter" id="form-filter">
								<option value=""><?php echo esc_html__( 'All Forms', 'fair-registration' ); ?></option>
								<?php 
								$forms = $this->get_forms_with_registrations();
								foreach ( $forms as $form ) : ?>
									<option value="<?php echo esc_attr( $form->ID ); ?>">
										<?php echo esc_html( get_the_title( $form->ID ) ); ?>
									</option>
								<?php endforeach; ?>
							</select>
						<?php endif; ?>
						
						<select name="bulk-action" id="bulk-action-selector-top">
							<option value="-1"><?php echo esc_html__( 'Bulk Actions', 'fair-registration' ); ?></option>
							<option value="delete"><?php echo esc_html__( 'Delete', 'fair-registration' ); ?></option>
							<option value="export"><?php echo esc_html__( 'Export', 'fair-registration' ); ?></option>
						</select>
						<input type="submit" class="button action" value="<?php echo esc_attr__( 'Apply', 'fair-registration' ); ?>" />
					</div>
					
					<div class="tablenav-pages">
						<span class="displaying-num">
							<?php printf( esc_html__( '%d items', 'fair-registration' ), count( $registrations ) ); ?>
						</span>
					</div>
				</div>
				
				<?php if ( empty( $registrations ) ) : ?>
					<div class="notice notice-info">
						<p><?php echo esc_html__( 'No registrations found.', 'fair-registration' ); ?></p>
						<?php if ( $form_id ) : ?>
							<p><?php echo esc_html__( 'This form has not received any registrations yet.', 'fair-registration' ); ?></p>
						<?php endif; ?>
					</div>
				<?php else : ?>
					<table class="wp-list-table widefat fixed striped">
						<thead>
							<tr>
								<td class="manage-column column-cb check-column">
									<input type="checkbox" id="cb-select-all-1" />
								</td>
								<th scope="col" class="manage-column column-name">
									<?php echo esc_html__( 'Name', 'fair-registration' ); ?>
								</th>
								<th scope="col" class="manage-column column-email">
									<?php echo esc_html__( 'Email', 'fair-registration' ); ?>
								</th>
								<?php if ( ! $form_id ) : ?>
								<th scope="col" class="manage-column column-form">
									<?php echo esc_html__( 'Form', 'fair-registration' ); ?>
								</th>
								<?php endif; ?>
								<th scope="col" class="manage-column column-date">
									<?php echo esc_html__( 'Date', 'fair-registration' ); ?>
								</th>
								<th scope="col" class="manage-column column-actions">
									<?php echo esc_html__( 'Actions', 'fair-registration' ); ?>
								</th>
							</tr>
						</thead>
						<tbody>
							<?php foreach ( $registrations as $registration ) : ?>
								<tr>
									<th scope="row" class="check-column">
										<input type="checkbox" name="registration[]" value="<?php echo esc_attr( $registration['id'] ); ?>" />
									</th>
									<td class="column-name">
										<strong><?php echo esc_html( $registration['name'] ); ?></strong>
									</td>
									<td class="column-email">
										<a href="mailto:<?php echo esc_attr( $registration['email'] ); ?>">
											<?php echo esc_html( $registration['email'] ); ?>
										</a>
									</td>
									<?php if ( ! $form_id ) : ?>
									<td class="column-form">
										<a href="<?php echo esc_url( admin_url( 'admin.php?page=fair-registration-registrations&form_id=' . $registration['form_id'] ) ); ?>">
											<?php echo esc_html( get_the_title( $registration['form_id'] ) ); ?>
										</a>
									</td>
									<?php endif; ?>
									<td class="column-date">
										<?php echo esc_html( $registration['date'] ); ?>
									</td>
									<td class="column-actions">
										<button type="button" class="button button-small" onclick="viewRegistrationDetails(<?php echo esc_attr( $registration['id'] ); ?>)">
											<?php echo esc_html__( 'View Details', 'fair-registration' ); ?>
										</button>
									</td>
								</tr>
							<?php endforeach; ?>
						</tbody>
					</table>
				<?php endif; ?>
			</div>
		</div>

		<script>
		function viewRegistrationDetails(registrationId) {
			// TODO: Implement modal or navigation to detailed view
			alert('Registration details for ID: ' + registrationId);
		}
		</script>

		<?php
	}

	/**
	 * Get registrations for a specific form or all registrations
	 *
	 * @param int $form_id Optional. Form ID to filter by.
	 * @return array Array of registration data
	 */
	private function get_registrations( $form_id = null ) {
		$db_manager = Plugin::instance()->get_db_manager();
		
		if ( $form_id ) {
			$registrations = $db_manager->get_registrations_by_form( $form_id );
		} else {
			$registrations = $db_manager->get_all_registrations();
		}

		// Format the data for display
		$formatted_registrations = array();
		foreach ( $registrations as $registration ) {
			$reg_data = $registration['registration_data'] ?? array();
			
			// Extract name and email from field array format
			$name = 'N/A';
			$email = 'N/A';
			
			if ( is_array( $reg_data ) ) {
				foreach ( $reg_data as $field ) {
					if ( is_array( $field ) && isset( $field['name'], $field['value'] ) ) {
						if ( $field['name'] === 'name' ) {
							$name = $field['value'];
						} elseif ( $field['name'] === 'email' ) {
							$email = $field['value'];
						}
					}
				}
			}
			
			$formatted_registrations[] = array(
				'id' => $registration['id'],
				'name' => $name,
				'email' => $email,
				'form_id' => $registration['form_id'],
				'date' => $registration['created']
			);
		}

		return $formatted_registrations;
	}

	/**
	 * Get all forms that have registrations
	 *
	 * @return array Array of post objects
	 */
	private function get_forms_with_registrations() {
		$db_manager = Plugin::instance()->get_db_manager();
		$forms_data = $db_manager->get_forms_with_registrations();
		
		$forms = array();
		foreach ( $forms_data as $form_data ) {
			$post = get_post( $form_data['form_id'] );
			if ( $post ) {
				$forms[] = $post;
			}
		}

		return $forms;
	}
}