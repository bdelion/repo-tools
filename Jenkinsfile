@Library(['enterprise-pipeline-library']) _
import fr.enterprise.ingdev.forge.*
import fr.enterprise.ingdev.jenkins.*

forgePipeline {
  Actions.addPostInitAction {
      if (Project.isProjectType(ProjectTypes.NODE)) {
          Stage nodeBuildStage = Pipeline.findFirstStage(StageTags.NODE, StageTags.BUILD)
          Stage nodeLintStage = new Stage(name: 'Lint (Node)', tags: [StageTags.TEST, 'LINT'], action:
                  {
                      withEnv(['CI=true']) {
                          script {
                              Node.execute('run lint')
                          }
                      }
                  }
          )
          nodeLintStage.insertBefore(nodeBuildStage)
      }
  }
  // Tags pour regrouper les projets par tribu, squad, produit, ...
  RunContext.set(sonarCustomTags: 'communs-du-dev, repo, tools')
}